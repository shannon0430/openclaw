import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferredCore } from "../../shared/deferred.js";
import type { applyPluginNodeInvokePolicy } from "../node-invoke-plugin-policy.js";
import type { NodeInvokeParams } from "../node-invoke.types.js";
import { resetNodeWakeStateForTest } from "../node-wake-state.test-support.js";
import { nodeInvokeHandlers } from "./nodes.invoke.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  capturePairing: vi.fn(),
  pairingCurrent: vi.fn(),
  pluginPolicy: vi.fn<typeof applyPluginNodeInvokePolicy>(),
}));

vi.mock("../../infra/device-pairing-node-state.js", () => ({
  captureNodePairingGeneration: mocks.capturePairing,
  isNodePairingGenerationCurrent: mocks.pairingCurrent,
}));
vi.mock("../node-command-policy.js", () => ({
  DEFAULT_DANGEROUS_NODE_COMMANDS: [],
  isForegroundRestrictedPluginNodeCommand: () => false,
  isNodeCommandAllowed: () => ({ ok: true }),
  resolveNodeCommandAllowlist: () => new Set(["computer.act", "screen.snapshot"]),
}));
vi.mock("../node-invoke-plugin-policy.js", () => ({
  applyPluginNodeInvokePolicy: mocks.pluginPolicy,
}));
vi.mock("../node-invoke-sanitize.js", () => ({
  sanitizeNodeInvokeParamsForForwarding: ({ rawParams }: { rawParams: unknown }) => ({
    ok: true,
    params: rawParams,
  }),
}));

beforeEach(() => {
  resetNodeWakeStateForTest();
  vi.resetAllMocks();
  mocks.capturePairing.mockResolvedValue({ nodeId: "desktop", key: "generation" });
  mocks.pairingCurrent.mockResolvedValue(true);
  mocks.pluginPolicy.mockResolvedValue(null);
});

afterEach(() => resetNodeWakeStateForTest());

function startInvoke(options: {
  guard: () => void;
  invoke: (
    request: NodeInvokeParams,
  ) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}) {
  const node = {
    nodeId: "desktop",
    connId: "connection",
    pairingGeneration: "generation",
    commands: ["computer.act", "screen.snapshot"],
    client: { invalidated: false },
  };
  const respond = vi.fn();
  const handler = nodeInvokeHandlers["node.invoke"]!;
  const invocation = handler({
    req: { type: "req", id: "computer-request", method: "node.invoke" },
    params: {
      nodeId: node.nodeId,
      command: "computer.act",
      params: { action: "list_windows", executionId: "execution" },
      idempotencyKey: "computer-request",
    },
    client: null,
    isWebchatConnect: () => false,
    respond,
    sessionMutationCommitGuard: options.guard,
    context: {
      nodeRegistry: {
        get: () => node,
        getForPairingGeneration: () => node,
        invoke: options.invoke,
      },
      getRuntimeConfig: () => ({}),
      logGateway: { info: vi.fn(), warn: vi.fn() },
    } as unknown as GatewayRequestHandlerOptions["context"],
  });
  return { invocation, respond };
}

describe("node.invoke scoped dispatch authority", () => {
  it("checks revoked computer authority at the queued raw transport boundary", async () => {
    const queued = createDeferredCore();
    const release = createDeferredCore();
    const effect = vi.fn();
    let current = true;
    const invoke = vi.fn(async (request: NodeInvokeParams) => {
      queued.resolve();
      await release.promise;
      if (request.isDispatchAuthorized?.() === false) {
        return { ok: false, error: { code: "AUTHORITY_CLOSED", message: "scope revoked" } };
      }
      effect();
      return { ok: true };
    });
    const work = startInvoke({
      invoke,
      guard: () => {
        if (!current) {
          throw new Error("scoped computer authority revoked");
        }
      },
    });
    await queued.promise;
    current = false;
    release.resolve();
    await work.invocation;
    expect(effect).not.toHaveBeenCalled();
    expect(work.respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("carries the scoped fence through queued plugin dispatch", async () => {
    const queued = createDeferredCore();
    const release = createDeferredCore();
    const effect = vi.fn();
    let current = true;
    mocks.pluginPolicy.mockImplementationOnce(async (request) => {
      queued.resolve();
      await release.promise;
      const admitted =
        (await request.isInvocationCurrent?.()) !== false &&
        request.isApprovalAuthorityActive?.() !== false;
      if (admitted) {
        effect();
        return { ok: true, payload: { ok: true } };
      }
      return { ok: false, code: "AUTHORITY_CLOSED", message: "scope revoked" };
    });
    const invoke = vi.fn(async () => ({ ok: true }));
    const work = startInvoke({
      invoke,
      guard: () => {
        if (!current) {
          throw new Error("scoped computer authority revoked");
        }
      },
    });
    await queued.promise;
    current = false;
    release.resolve();
    await work.invocation;
    expect(effect).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(work.respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("rejects an already retired source before node preparation", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const work = startInvoke({
      invoke,
      guard: () => {
        throw new Error("source retired");
      },
    });
    await work.invocation;
    expect(mocks.capturePairing).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(work.respond.mock.calls[0]?.[0]).toBe(false);
  });
});
