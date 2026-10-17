import { Value } from "typebox/value";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeInvokeParamsSchema } from "../../packages/gateway-protocol/src/schema/nodes.js";
import { registerComputerUseProvider } from "../plugins/computer-use-registration.js";
import type { OpenClawPluginNodeHostCommand } from "../plugins/types.node-host.js";
import { createDeferredCore } from "../shared/deferred.js";
import { createAgentCleanupScope, runAgentCleanupStep } from "./run-cleanup-timeout.js";
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

function connectProvider(closeError?: Error) {
  const commands = new Map<string, OpenClawPluginNodeHostCommand>();
  const events: Array<{ action: string; executionId: string }> = [];
  const close = vi.fn(async (executionId: string) => {
    events.push({ action: "close", executionId });
    if (closeError) {
      throw closeError;
    }
  });
  const openExecution = vi.fn(async ({ executionId }: { executionId: string }) => {
    events.push({ action: "open", executionId });
    return {
      snapshot: async () => JSON.stringify({ ok: true }),
      act: async () => {
        events.push({ action: "act", executionId });
        return JSON.stringify({ ok: true });
      },
      close: async () => await close(executionId),
    };
  });
  registerComputerUseProvider(
    { registerNodeHostCommand: (command) => commands.set(command.command, command) },
    {
      id: "fixture",
      label: "Fixture",
      isAvailable: () => true,
      capabilities: () => ({
        contractVersion: 2,
        provider: { id: "fixture", label: "Fixture", generation: "generation-1" },
        actions: ["type"],
        targets: ["screen"],
        deliveryModes: ["foreground"],
        observations: [],
        features: { recording: false, agentCursor: false, multiDisplay: false },
      }),
      openExecution,
    },
  );
  const dispatch = async ({ command, params }: { command: string; params: unknown }) => {
    const registered = commands.get(command);
    if (!registered) {
      throw new Error(`Unexpected computer command: ${command}`);
    }
    return { payload: JSON.parse(await registered.handle(JSON.stringify(params))) as unknown };
  };
  mocks.callGateway.mockImplementation(async (_method, _options, params, request) => {
    expect(Value.Check(NodeInvokeParamsSchema, params)).toBe(true);
    request.dispatchAuthority.assertCurrent();
    return await dispatch(params);
  });
  mocks.closeRequest.mockImplementation(async (request) => {
    expect(Value.Check(NodeInvokeParamsSchema, request.params)).toBe(true);
    request.assertDispatchCurrent();
    return await dispatch(request.params);
  });
  return { openExecution, close, events };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pairingCurrent.mockReturnValue(true);
  mocks.callGateway.mockImplementation(async (_method, _options, params) => {
    expect(Value.Check(NodeInvokeParamsSchema, params)).toBe(true);
    return { payload: { ok: true } };
  });
  mocks.closeRequest.mockImplementation(async (request) => {
    expect(Value.Check(NodeInvokeParamsSchema, request.params)).toBe(true);
    return { payload: { ok: true } };
  });
});

describe("scoped paired computer preparation", () => {
  it("closes the exact provider execution between independent scoped acquisitions without foreign eviction", async () => {
    const h = createHarness();
    const provider = connectProvider();
    const first = (await prepareScopedPairedComputerTransport(h.options))!;
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const input = (executionId: string) => ({
      nodeId: h.node.nodeId,
      command: "computer.act" as const,
      commandParams: { action: "type", text: "fixture", executionId },
    });
    const close = (executionId: string) => ({
      ...input(executionId),
      commandParams: { action: "__close_execution", executionId, reason: "completion" },
    });
    await first.invoke(input(firstId));

    const second = (await prepareScopedPairedComputerTransport(h.options))!;
    await expect(second.invoke(close(firstId))).rejects.toThrow("unowned execution");
    await expect(second.invoke(input(secondId))).rejects.toThrow("COMPUTER_HOST_BUSY");
    await second.invoke(close(secondId));
    expect(provider.close).not.toHaveBeenCalled();
    expect(provider.openExecution).toHaveBeenCalledOnce();

    await first.invoke(close(firstId));
    await first.invoke(close(firstId));
    await expect(first.invoke(input(firstId))).rejects.toThrow("execution is closed");
    // A new independent binding never reuses the failed acquisition.
    const next = (await prepareScopedPairedComputerTransport(h.options))!;
    await next.invoke(input(secondId));
    await next.invoke(close(secondId));
    expect(provider.events).toEqual([
      { action: "open", executionId: firstId },
      { action: "act", executionId: firstId },
      { action: "close", executionId: firstId },
      { action: "open", executionId: secondId },
      { action: "act", executionId: secondId },
      { action: "close", executionId: secondId },
    ]);
  });

  it("records uncertain exact provider teardown without retrying or granting another execution", async () => {
    const h = createHarness();
    const failure = new Error("native exact execution close failed");
    const provider = connectProvider(failure);
    const transport = (await prepareScopedPairedComputerTransport(h.options))!;
    const executionId = "00000000-0000-4000-8000-000000000001";
    await transport.invoke({
      nodeId: h.node.nodeId,
      command: "computer.act",
      commandParams: { action: "type", text: "fixture", executionId },
    });
    const scope = createAgentCleanupScope();
    const log = { warn: vi.fn() };
    const close = {
      nodeId: h.node.nodeId,
      command: "computer.act" as const,
      commandParams: { action: "__close_execution", executionId, reason: "completion" },
    };
    await scope.run(async () => {
      await runAgentCleanupStep({
        runId: "run",
        sessionId: "session",
        step: "codex-dynamic-tool-cleanup",
        log,
        cleanup: async () => {
          await transport.invoke(close);
        },
      });
    });
    expect(scope.outcome).toBe("uncertain");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    await expect(transport.invoke(close)).rejects.toBe(failure);
    expect(provider.close).toHaveBeenCalledExactlyOnceWith(executionId);
    const next = (await prepareScopedPairedComputerTransport(h.options))!;
    await expect(
      next.invoke({
        nodeId: h.node.nodeId,
        command: "computer.act",
        commandParams: {
          action: "type",
          text: "must not acquire",
          executionId: "00000000-0000-4000-8000-000000000002",
        },
      }),
    ).rejects.toBe(failure);
    expect(provider.openExecution).toHaveBeenCalledOnce();
  });

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

  it("gives independent unkeyed screenshots valid RPC keys and preserves an explicit action key", async () => {
    const h = createHarness();
    const transport = (await prepareScopedPairedComputerTransport(h.options))!;
    const screenshot = {
      nodeId: h.node.nodeId,
      command: "screen.snapshot" as const,
      commandParams: { executionId: "owned-execution", screenIndex: 0, format: "jpeg" },
    };
    await transport.invoke(screenshot);
    await transport.invoke(screenshot);
    const actionKey = "computer.act:v1:original-call";
    const action = {
      nodeId: h.node.nodeId,
      command: "computer.act" as const,
      commandParams: { executionId: "owned-execution", action: "key", keys: "Return" },
      idempotencyKey: actionKey,
    };
    await transport.invoke(action);
    await transport.invoke(action);
    const requests = mocks.callGateway.mock.calls.map((call) => call[2]);
    expect(requests).toHaveLength(4);
    expect(requests[0].idempotencyKey).not.toBe(requests[1].idempotencyKey);
    expect(requests.slice(2).map((request) => request.idempotencyKey)).toEqual([
      actionKey,
      actionKey,
    ]);
    expect(new Set(requests.map((request) => request.idempotencyKey)).size).toBe(3);
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

  it.each(["grant", "pairing", "connection", "Gateway", "run", "agent", "session", "resolver"])(
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
      } else if (kind === "agent") {
        h.caller.agentId = "replacement-agent";
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
