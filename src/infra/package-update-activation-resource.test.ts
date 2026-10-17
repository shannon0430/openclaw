import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withUpdateCommandExecutor } from "../cli/update-cli/update-command-executor.js";
import * as durability from "./directory-durability.js";
import { createPackageActivationLifetimeFixture } from "./package-update-activation-lifetime.test-support.js";
import {
  resolvePackageActivationAnchor,
  resolvePackageActivationControl,
} from "./package-update-activation-paths.js";
import { packageActivationRuntimeForTest } from "./package-update-activation-runtime.test-support.js";
import { assertNoPendingPackageActivation } from "./package-update-activation.js";
import {
  PackageIntegrityLimitError,
  PackageIntegrityTimeoutError,
} from "./package-update-integrity.js";
import type { PackageUpdateTransaction } from "./package-update-swap-contract.js";
import { swapStagedPackageInstall } from "./package-update-swap.js";
import { createPackageSwapFixture } from "./package-update-swap.test-support.js";

const fixtures = createPackageActivationLifetimeFixture();
let root: string;
beforeEach(() => {
  ({ root } = fixtures.setup());
});
afterEach(async () => {
  try {
    await fixtures.lifetime.cleanup();
  } finally {
    vi.restoreAllMocks();
  }
});

describe.skipIf(process.platform === "win32")("bounded publication preparation", () => {
  it.each(["entry", "byte", "timeout"] as const)(
    "keeps the native transaction and rollback when the candidate exhausts its %s budget",
    async (budget) => {
      const f = await createPackageSwapFixture(root);
      await fixtures.writePostCoreCapability(f.params.stage.packageRoot);
      const stageRoot = f.params.stage.packageRoot;
      const [child] = await fsp.readdir(stageRoot, { withFileTypes: true });
      const opendir = fsp.opendir.bind(fsp);
      let discovered = 0;
      vi.spyOn(fsp, "opendir").mockImplementation(async (...args) => {
        if (String(args[0]) !== stageRoot) {
          return opendir(...args);
        }
        if (budget !== "entry") {
          throw budget === "byte"
            ? new PackageIntegrityLimitError("byte")
            : new PackageIntegrityTimeoutError(1);
        }
        const directory = await opendir(...args);
        const reader: { read(): Promise<typeof child | null> } = directory;
        // Exercise the actual 50k guard without writing a large dependency tree.
        vi.spyOn(reader, "read").mockImplementation(async () => {
          discovered++;
          return child!;
        });
        return directory;
      });
      const anchor = resolvePackageActivationAnchor(f.packageRoot);
      const prepared = vi.fn();
      const unavailable = vi.fn();
      const beforeActivate = vi.fn();
      await withUpdateCommandExecutor(randomUUID(), async (executor) => {
        const fence = await executor.enter(f.packageRoot);
        let transaction: PackageUpdateTransaction | undefined;
        const result = await swapStagedPackageInstall({
          ...f.params,
          beforeActivate,
          activation: {
            fence,
            runtime: packageActivationRuntimeForTest(),
            onPrepared: prepared,
            onUnavailable: unavailable,
          },
          onTransaction: (issued) => {
            transaction = issued;
          },
        });
        expect(result.status, result.step.stderrTail ?? "").toBe("committed");
        expect(prepared).not.toHaveBeenCalled();
        expect(unavailable).toHaveBeenCalledOnce();
        expect(beforeActivate).toHaveBeenCalledOnce();
        expect(result.step.advisory).toMatchObject({ kind: "recoverable-maintenance" });
        expect(result.step.warnings).toEqual([unavailable.mock.calls[0]![0]]);
        expect(result.step.advisory?.message).toContain(
          budget === "timeout" ? "verification timed out" : `${budget} limit exceeded`,
        );
        if (budget === "entry") {
          expect(discovered).toBe(50_000);
        }
        expect(transaction).toBeDefined();
        expect(transaction!.databaseBackupRoot).toBeUndefined();
        expect(fs.existsSync(anchor)).toBe(false);
        expect(fs.existsSync(resolvePackageActivationControl(anchor))).toBe(false);
        expect(() => assertNoPendingPackageActivation(f.packageRoot)).not.toThrow();
        expect(fs.readFileSync(path.join(f.packageRoot, "package.json"), "utf8")).toContain(
          '"version":"2.0.0"',
        );
        expect(fs.readFileSync(f.launcher, "utf8")).toBe("candidate launcher\n");
        expect(
          fs.readFileSync(path.join(transaction!.backupRoot, "package.json"), "utf8"),
        ).toContain('"version":"1.0.0"');
        expect(await transaction!.rollback(fence.assertCurrent)).toMatchObject({ exitCode: 0 });
        expect(fs.readFileSync(path.join(f.packageRoot, "package.json"), "utf8")).toContain(
          '"version":"1.0.0"',
        );
        expect(fs.readFileSync(f.launcher, "utf8")).toBe("old launcher\n");
        expect(
          await transaction!.complete({ activationVerified: false }, fence.assertCurrent),
        ).toBeUndefined();
      });
    },
  );

  it.each([
    new Error("Package rollback filesystem identity is unavailable"),
    Object.assign(new Error("candidate fingerprint denied"), { code: "EACCES" }),
  ])("refuses a genuine candidate fingerprint error: %s", async (failure) => {
    const f = await createPackageSwapFixture(root);
    await fixtures.writePostCoreCapability(f.params.stage.packageRoot);
    const opendir = fsp.opendir.bind(fsp);
    vi.spyOn(fsp, "opendir").mockImplementation(async (...args) => {
      if (String(args[0]) === f.params.stage.packageRoot) {
        throw failure;
      }
      return opendir(...args);
    });
    const unavailable = vi.fn();
    const beforeActivate = vi.fn();
    const onTransaction = vi.fn();
    await withUpdateCommandExecutor(randomUUID(), async (executor) => {
      const result = await swapStagedPackageInstall({
        ...f.params,
        beforeActivate,
        onTransaction,
        activation: {
          fence: await executor.enter(f.packageRoot),
          runtime: packageActivationRuntimeForTest(),
          onPrepared: () => {},
          onUnavailable: unavailable,
        },
      });
      expect(result.status).toBe("failed");
      expect(result.step.stderrTail).toContain(failure.message);
      expect(result.step.advisory).toBeUndefined();
    });
    expect(unavailable).not.toHaveBeenCalled();
    expect(beforeActivate).not.toHaveBeenCalled();
    expect(onTransaction).not.toHaveBeenCalled();
    expect(fs.readFileSync(f.launcher, "utf8")).toBe("old launcher\n");
    expect(
      fs.existsSync(resolvePackageActivationControl(resolvePackageActivationAnchor(f.packageRoot))),
    ).toBe(false);
  });

  it("refuses the same resource error after taking candidate custody", async () => {
    const f = await createPackageSwapFixture(root);
    await fixtures.writePostCoreCapability(f.params.stage.packageRoot);
    const anchor = resolvePackageActivationAnchor(f.packageRoot);
    const sync = durability.syncDirectory;
    const failure = new PackageIntegrityLimitError("entry");
    let custodyObserved = false;
    vi.spyOn(durability, "syncDirectory").mockImplementation(async (directory) => {
      if (fs.existsSync(path.join(anchor, "candidate"))) {
        custodyObserved = true;
        throw failure;
      }
      return sync(directory);
    });
    const unavailable = vi.fn();
    const beforeActivate = vi.fn();
    const onTransaction = vi.fn();
    const outcome = await withUpdateCommandExecutor(randomUUID(), async (executor) =>
      swapStagedPackageInstall({
        ...f.params,
        beforeActivate,
        onTransaction,
        activation: {
          fence: await executor.enter(f.packageRoot),
          runtime: packageActivationRuntimeForTest(),
          onPrepared: () => {},
          onUnavailable: unavailable,
        },
      }),
    ).then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );
    expect(custodyObserved, outcome.result?.step.stderrTail ?? "").toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(outcome.result?.status).toBe("failed");
    expect(outcome.result?.step.stderrTail).toContain(failure.message);
    expect(unavailable).not.toHaveBeenCalled();
    expect(beforeActivate).not.toHaveBeenCalled();
    expect(onTransaction).not.toHaveBeenCalled();
    expect(fs.existsSync(resolvePackageActivationControl(anchor))).toBe(true);
    expect(fs.existsSync(path.join(anchor, "candidate"))).toBe(true);
    expect(() => assertNoPendingPackageActivation(f.packageRoot)).toThrow();
    expect(fs.readFileSync(f.launcher, "utf8")).toBe("old launcher\n");
  });

  it("does not bypass existing recovery admission after a resource refusal", async () => {
    const f = await createPackageSwapFixture(root);
    await fixtures.writePostCoreCapability(f.params.stage.packageRoot);
    const anchor = resolvePackageActivationAnchor(f.packageRoot);
    fs.mkdirSync(resolvePackageActivationControl(anchor), { mode: 0o700 });
    const opendir = fsp.opendir.bind(fsp);
    vi.spyOn(fsp, "opendir").mockImplementation(async (...args) => {
      if (String(args[0]) === f.params.stage.packageRoot) {
        throw new PackageIntegrityLimitError("entry");
      }
      return opendir(...args);
    });
    const unavailable = vi.fn();
    const beforeActivate = vi.fn();
    const onTransaction = vi.fn();
    const result = await withUpdateCommandExecutor(randomUUID(), async (executor) =>
      swapStagedPackageInstall({
        ...f.params,
        beforeActivate,
        onTransaction,
        activation: {
          fence: await executor.enter(f.packageRoot),
          runtime: packageActivationRuntimeForTest(),
          onPrepared: () => {},
          onUnavailable: unavailable,
        },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.step.stderrTail).toContain("Incomplete or legacy recovery artifacts");
    expect(unavailable).not.toHaveBeenCalled();
    expect(beforeActivate).not.toHaveBeenCalled();
    expect(onTransaction).not.toHaveBeenCalled();
    expect(fs.existsSync(resolvePackageActivationControl(anchor))).toBe(true);
    expect(fs.readFileSync(f.launcher, "utf8")).toBe("old launcher\n");
  });
});
