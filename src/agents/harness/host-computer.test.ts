import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createDeferredCore } from "../../shared/deferred.js";
import type { EmbeddedRunAttemptParams } from "../embedded-agent-runner/run/types.js";
import type { ScopedPairedComputerPreparation } from "../scoped-paired-computer.js";
import type { ComputerToolTransport } from "../tools/computer-tool-shared.js";
import { createHarnessComputerPreparation } from "./host-computer.js";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  placement: vi.fn(),
  context: vi.fn(),
}));
vi.mock("../scoped-paired-computer.js", () => ({
  prepareScopedPairedComputerTransport: mocks.prepare,
}));
vi.mock("../session-placement-computer.js", () => ({
  resolveSessionPlacementComputer: mocks.placement,
  resolveSessionPlacementSandboxToolPolicy: (policy: unknown) => policy,
}));
vi.mock("../tools/in-process-gateway.js", () => ({
  getInProcessGatewayToolContext: mocks.context,
}));

const granted: OpenClawConfig = {
  agents: { entries: { business: { tools: { alsoAllow: ["computer"] } } } },
};

function fixture(overrides: Partial<EmbeddedRunAttemptParams> = {}) {
  const attempt: Partial<EmbeddedRunAttemptParams> = {
    agentId: "business",
    sessionKey: "agent:business:slack:dm:guest",
    sessionId: "business-conversation",
    runId: "business-run",
    senderId: "guest",
    senderIsOwner: false,
    messageProvider: "slack",
    model: {
      id: "fixture-model",
      provider: "fixture",
      input: ["text", "image"],
    } as EmbeddedRunAttemptParams["model"],
    ...overrides,
  };
  const assertCurrent = vi.fn();
  const withCaller = vi.fn(async <T>(run: () => Promise<T>) => await run());
  const preparation = createHarnessComputerPreparation({
    attempt,
    config: granted,
    operationalRunInstance: { instanceId: "business-instance", runId: "business-run" },
    assertCurrent,
    withCaller,
  });
  return { attempt, assertCurrent, withCaller, preparation };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.placement.mockReturnValue(undefined);
  mocks.context.mockReturnValue(undefined);
  mocks.prepare.mockImplementation(async (options: ScopedPairedComputerPreparation) => {
    options.canUseComputer();
    return undefined;
  });
});

describe("private harness computer preparation", () => {
  it("settles one preparation before a catalog consumer can read the transport", async () => {
    const desktop = {
      resolveNode: vi.fn(),
      invoke: vi.fn(),
    } satisfies ComputerToolTransport;
    const discovery = createDeferredCore<ComputerToolTransport>();
    mocks.prepare.mockReturnValue(discovery.promise);
    const h = fixture();
    expect(h.preparation.transport()).toBeUndefined();
    const first = h.preparation.prepare();
    const second = h.preparation.prepare();
    const catalog = vi.fn(() => h.preparation.transport());
    const published = first.then(catalog);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(h.withCaller).toHaveBeenCalledTimes(1);
    expect(catalog).not.toHaveBeenCalled();
    expect(h.preparation.transport()).toBeUndefined();
    discovery.resolve(desktop);
    await expect(published).resolves.toBe(desktop);
    await second;
    await h.preparation.prepare();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(h.assertCurrent).toHaveBeenCalled();
  });

  it("rechecks current runtime grants and policy ceilings rather than the admission snapshot", async () => {
    let runtimeConfig = granted;
    mocks.context.mockReturnValue({ getRuntimeConfig: () => runtimeConfig });
    const h = fixture();
    await h.preparation.prepare();
    const options = mocks.prepare.mock.calls[0][0] as ScopedPairedComputerPreparation;
    expect(options.canUseComputer()).toBe(true);
    runtimeConfig = {};
    expect(options.canUseComputer()).toBe(false);
    runtimeConfig = {
      ...granted,
      tools: { toolsBySender: { "id:guest": { deny: ["computer"] } } },
    };
    expect(options.canUseComputer()).toBe(false);
    runtimeConfig = granted;
    expect(options.canUseComputer()).toBe(true);
    h.assertCurrent.mockImplementation(() => {
      throw new Error("admitted run closed");
    });
    expect(options.canUseComputer).toThrow("admitted run closed");
  });

  it("rejects retained preparation after the admitted host closes", async () => {
    const h = fixture();
    await h.preparation.prepare();
    h.assertCurrent.mockImplementation(() => {
      throw new Error("admitted run closed");
    });
    await expect(Promise.resolve().then(() => h.preparation.prepare())).rejects.toThrow(
      "admitted run closed",
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "owner", overrides: { senderIsOwner: true } },
    { name: "unknown sender", overrides: { senderIsOwner: undefined } },
    { name: "disabled tools", overrides: { disableTools: true } },
    {
      name: "sandbox",
      overrides: { sandbox: { enabled: true } as EmbeddedRunAttemptParams["sandbox"] },
    },
    {
      name: "non-vision model",
      overrides: {
        model: {
          id: "text-only",
          provider: "fixture",
          input: ["text"],
        } as EmbeddedRunAttemptParams["model"],
      },
    },
  ])(
    "does not broaden $name source posture after a plugin mutates the attempt",
    async ({ overrides }) => {
      const h = fixture(overrides);
      h.attempt.senderIsOwner = false;
      h.attempt.disableTools = false;
      h.attempt.sandbox = undefined;
      h.attempt.model = {
        id: "replacement",
        provider: "fixture",
        input: ["text", "image"],
      } as EmbeddedRunAttemptParams["model"];
      await h.preparation.prepare();
      expect(mocks.prepare).not.toHaveBeenCalled();
    },
  );

  it.each(["conversation", "sandbox"])(
    "retains the captured %s deny after a plugin edits its source policy",
    async (kind) => {
      const policy = { allow: ["*"], deny: ["computer"] };
      const h = fixture(
        kind === "conversation"
          ? { conversationToolPolicy: policy }
          : {
              sandbox: { enabled: false, tools: policy } as EmbeddedRunAttemptParams["sandbox"],
            },
      );
      policy.deny.length = 0;
      await h.preparation.prepare();
      const options = mocks.prepare.mock.calls[0][0] as ScopedPairedComputerPreparation;
      expect(options.canUseComputer()).toBe(false);
    },
  );

  it.each([null, { resolveNode: vi.fn(), invoke: vi.fn() }])(
    "does not replace an existing placement decision: %j",
    async (placement) => {
      mocks.placement.mockReturnValue(placement);
      const h = fixture();
      await h.preparation.prepare();
      expect(mocks.prepare).not.toHaveBeenCalled();
    },
  );
});
