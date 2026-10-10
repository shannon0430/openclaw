import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferredCore } from "../shared/deferred.js";
import {
  isScopedPairedComputerTransport,
  prepareScopedPairedComputerTransport,
} from "./scoped-paired-computer.js";

const mocks = vi.hoisted(() => ({
  caller: vi.fn(),
  context: vi.fn(),
  assertCaller: vi.fn(),
  pairingCurrent: vi.fn(),
  closeRequest: vi.fn(),
  callGateway: vi.fn(),
}));

vi.mock("../infra/device-pairing-node-state.js", () => ({
  isPairedDeviceNodeBindingCurrent: mocks.pairingCurrent,
}));
vi.mock("./tools/gateway-caller-context.js", () => ({
  getGatewayToolCallerIdentity: mocks.caller,
  captureGatewayToolCallerAssertion: () => mocks.assertCaller,
}));
vi.mock("./tools/gateway.js", () => ({ callGatewayTool: mocks.callGateway }));
vi.mock("./tools/in-process-gateway.js", () => ({
  getInProcessGatewayToolContext: mocks.context,
  runWithGatewayToolCleanupContext: (run: () => unknown) => run(),
  bindAgentToolGatewayRequest: () => mocks.closeRequest,
}));

function createHarness() {
  const node = {
    nodeId: "approved-desktop",
    connId: "desktop-connection",
    pairingIdentity: "pairing-identity",
    pairingGeneration: "pairing-generation",
    commands: ["computer.act", "screen.snapshot"],
    client: { invalidated: false },
  };
  const registry = {
    listCurrentConnected: vi.fn(async () => [node]),
    get: vi.fn(() => node),
  };
  const context = { nodeRegistry: registry };
  const caller = {
    agentId: "business",
    sessionKey: "agent:business:slack:thread",
    operationalRunInstance: { instanceId: "instance", runId: "run" },
    gatewayContextResolver: () => context,
  };
  mocks.caller.mockReturnValue(caller);
  mocks.context.mockReturnValue(context);
  const options = { assertCurrent: vi.fn(), canUseComputer: vi.fn(() => true) };
  return { node, registry, context, caller, options };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pairingCurrent.mockReturnValue(true);
  mocks.callGateway.mockResolvedValue({ payload: { ok: true } });
  mocks.closeRequest.mockResolvedValue({ payload: { ok: true } });
});

describe("scoped paired computer preparation", () => {
  it("issues only a host-bound singleton and never accepts a copied transport as provenance", async () => {
    const h = createHarness();
    const transport = await prepareScopedPairedComputerTransport(h.options);
    expect(transport).toBeDefined();
    expect(isScopedPairedComputerTransport(transport)).toBe(true);
    expect(isScopedPairedComputerTransport({ ...transport })).toBe(false);
    expect(isScopedPairedComputerTransport(null)).toBe(false);
    expect(isScopedPairedComputerTransport(undefined)).toBe(false);
    expect(await transport!.resolveNode()).toMatchObject({ nodeId: h.node.nodeId });
    await expect(transport!.resolveNode(h.node.nodeId)).rejects.toThrow("node selector");
    await transport!.invoke({
      nodeId: h.node.nodeId,
      command: "screen.snapshot",
      commandParams: { executionId: "owned-execution" },
    });
    expect(mocks.callGateway).toHaveBeenCalledWith(
      "node.invoke",
      {},
      expect.objectContaining({ nodeId: h.node.nodeId, command: "screen.snapshot" }),
      expect.objectContaining({ requireAgentRuntimeIdentity: true }),
    );
  });

  it.each([0, 2])("does not qualify %i eligible desktops", async (count) => {
    const h = createHarness();
    h.registry.listCurrentConnected.mockResolvedValue(
      Array.from({ length: count }, (_, index) => ({ ...h.node, nodeId: `desktop-${index}` })),
    );
    expect(await prepareScopedPairedComputerTransport(h.options)).toBeUndefined();
    expect(mocks.callGateway).not.toHaveBeenCalled();
  });

  it("requires the explicit grant, admitted caller, and authenticated pairing generation", async () => {
    const h = createHarness();
    h.options.canUseComputer.mockReturnValue(false);
    expect(await prepareScopedPairedComputerTransport(h.options)).toBeUndefined();
    expect(h.registry.listCurrentConnected).not.toHaveBeenCalled();
    h.options.canUseComputer.mockReturnValue(true);
    mocks.caller.mockReturnValue(undefined);
    expect(await prepareScopedPairedComputerTransport(h.options)).toBeUndefined();
    mocks.caller.mockReturnValue(h.caller);
    h.node.pairingGeneration = "";
    expect(await prepareScopedPairedComputerTransport(h.options)).toBeUndefined();
  });

  it("rechecks host permission after asynchronous discovery", async () => {
    const h = createHarness();
    const discovery = createDeferredCore<(typeof h.node)[]>();
    h.registry.listCurrentConnected.mockReturnValue(discovery.promise);
    const prepared = prepareScopedPairedComputerTransport(h.options);
    h.options.canUseComputer.mockReturnValue(false);
    discovery.resolve([h.node]);
    await expect(prepared).rejects.toThrow("authority is no longer current");
  });

  it.each(["grant", "pairing", "connection", "Gateway", "run", "session", "resolver"])(
    "retained input fails after %s replacement or revocation",
    async (kind) => {
      const h = createHarness();
      const transport = (await prepareScopedPairedComputerTransport(h.options))!;
      if (kind === "grant") {
        h.options.canUseComputer.mockReturnValue(false);
      } else if (kind === "pairing") {
        mocks.pairingCurrent.mockReturnValue(false);
      } else if (kind === "connection") {
        h.node.connId = "replacement-connection";
      } else if (kind === "Gateway") {
        mocks.context.mockReturnValue({ ...h.context });
      } else if (kind === "session") {
        h.caller.sessionKey = "replacement-session";
      } else if (kind === "resolver") {
        h.caller.gatewayContextResolver = () => h.context;
      } else {
        mocks.caller.mockReturnValue({
          ...h.caller,
          operationalRunInstance: { ...h.caller.operationalRunInstance },
        });
      }
      await expect(
        transport.invoke({
          nodeId: h.node.nodeId,
          command: "screen.snapshot",
          commandParams: { executionId: "execution" },
        }),
      ).rejects.toThrow(/current|replaced|revoked/);
      expect(mocks.callGateway).not.toHaveBeenCalled();
    },
  );

  it("fences a frozen pairing revoked while the local RPC is queued", async () => {
    const h = createHarness();
    const transport = (await prepareScopedPairedComputerTransport(h.options))!;
    const queued = createDeferredCore();
    const release = createDeferredCore();
    const effect = vi.fn();
    mocks.callGateway.mockImplementationOnce(async (_method, _options, _params, request) => {
      queued.resolve();
      await release.promise;
      request.dispatchAuthority.assertCurrent();
      effect();
      return { payload: { ok: true } };
    });
    const work = transport.invoke({
      nodeId: h.node.nodeId,
      command: "screen.snapshot",
      commandParams: { executionId: "queued-execution" },
    });
    await queued.promise;
    mocks.pairingCurrent.mockReturnValue(false);
    release.resolve();
    await expect(work).rejects.toThrow("replaced or revoked");
    expect(effect).not.toHaveBeenCalled();
  });

  it("allows only idempotent owned cleanup after input revocation, never replacement pairing", async () => {
    const h = createHarness();
    const transport = (await prepareScopedPairedComputerTransport(h.options))!;
    await transport.invoke({
      nodeId: h.node.nodeId,
      command: "screen.snapshot",
      commandParams: { executionId: "owned" },
    });
    h.options.canUseComputer.mockReturnValue(false);
    const close = {
      nodeId: h.node.nodeId,
      command: "computer.act" as const,
      commandParams: { action: "__close_execution", executionId: "owned" },
    };
    await transport.invoke(close);
    await transport.invoke(close);
    expect(mocks.closeRequest).toHaveBeenCalledTimes(1);
    await expect(
      transport.invoke({
        ...close,
        commandParams: { ...close.commandParams, executionId: "other" },
      }),
    ).rejects.toThrow("unowned execution");
    mocks.pairingCurrent.mockReturnValue(false);
    h.options.canUseComputer.mockReturnValue(true);
    await expect(transport.resolveNode()).rejects.toThrow("replaced or revoked");
    const closeGuard = mocks.closeRequest.mock.calls[0]![0].assertDispatchCurrent as () => void;
    expect(closeGuard).toThrow("replaced or revoked");
    expect(mocks.closeRequest).toHaveBeenCalledTimes(1);
  });
});
