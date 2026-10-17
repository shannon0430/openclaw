import crypto from "node:crypto";
import {
  isPairedDeviceNodeBindingCurrent,
  type PairedDeviceNodeBinding,
} from "../infra/device-pairing-node-state.js";
import { freezeJsonSnapshot } from "../shared/immutable-data.js";
import {
  COMPUTER_ACT_COMMAND,
  SCREEN_SNAPSHOT_COMMAND,
  type ComputerToolTransport,
} from "./tools/computer-tool-shared.js";
import {
  captureGatewayToolCallerAssertion,
  getGatewayToolCallerIdentity,
} from "./tools/gateway-caller-context.js";
import { callGatewayTool } from "./tools/gateway.js";
import {
  bindAgentToolGatewayRequest,
  getInProcessGatewayToolContext,
  runWithGatewayToolCleanupContext,
} from "./tools/in-process-gateway.js";

const scopedTransports = new WeakSet<object>();

/** Only core preparation can qualify the non-owner paired-computer exception. */
export function isScopedPairedComputerTransport(value: unknown): value is ComputerToolTransport {
  return value !== null && typeof value === "object" && scopedTransports.has(value);
}

export type ScopedPairedComputerPreparation = {
  /** Recheck the explicit agent grant and every current conversation policy ceiling. */
  canUseComputer: () => boolean;
  /** Host-owned admitted run assertion; never supplied by a plugin or model argument. */
  assertCurrent: () => void;
  signal?: AbortSignal;
};

/** Bind one approved paired desktop without granting Gateway desktop or node administration. */
export async function prepareScopedPairedComputerTransport(
  options: ScopedPairedComputerPreparation,
): Promise<ComputerToolTransport | undefined> {
  options.assertCurrent();
  options.signal?.throwIfAborted();
  if (!options.canUseComputer()) {
    return undefined;
  }
  const caller = getGatewayToolCallerIdentity();
  const assertCaller = captureGatewayToolCallerAssertion();
  const run = caller?.operationalRunInstance;
  const gatewayContextResolver = caller?.gatewayContextResolver;
  const resolveContext = () => getInProcessGatewayToolContext(gatewayContextResolver);
  const context = resolveContext();
  if (
    !caller ||
    !gatewayContextResolver ||
    !assertCaller ||
    !run ||
    !context ||
    context.localEmbedded
  ) {
    return undefined;
  }
  const agentId = caller.agentId;
  const sessionKey = caller.sessionKey;
  const assertSourceCurrent = () => {
    options.assertCurrent();
    options.signal?.throwIfAborted();
    assertCaller();
    const current = getGatewayToolCallerIdentity();
    if (
      current?.operationalRunInstance !== run ||
      current.agentId !== agentId ||
      current.sessionKey !== sessionKey ||
      current.gatewayContextResolver !== gatewayContextResolver ||
      resolveContext() !== context ||
      !options.canUseComputer()
    ) {
      throw new Error("Scoped paired computer authority is no longer current");
    }
  };
  assertSourceCurrent();
  // The registry reconciles authenticated pairing and approved command ceilings.
  // Do not discover the Gateway desktop or infer authority from a display name.
  const nodes = (await context.nodeRegistry.listCurrentConnected()).filter(
    (node) =>
      node.commands.includes(COMPUTER_ACT_COMMAND) &&
      node.commands.includes(SCREEN_SNAPSHOT_COMMAND),
  );
  assertSourceCurrent();
  if (nodes.length !== 1) {
    return undefined;
  }
  const node = nodes[0]!;
  if (!node.pairingIdentity || !node.pairingGeneration) {
    return undefined;
  }
  const pairing: PairedDeviceNodeBinding = Object.freeze({
    identity: node.pairingIdentity,
    generation: node.pairingGeneration,
  });
  const nodeId = node.nodeId;
  const connId = node.connId;
  const computerUse = node.computerUse
    ? freezeJsonSnapshot(structuredClone(node.computerUse))
    : undefined;
  const assertResourceCurrent = () => {
    const current = context.nodeRegistry.get(nodeId);
    if (
      resolveContext() !== context ||
      !isPairedDeviceNodeBindingCurrent(nodeId, pairing) ||
      !current ||
      current.connId !== connId ||
      current.pairingIdentity !== pairing.identity ||
      current.pairingGeneration !== pairing.generation ||
      current.client.invalidated
    ) {
      throw new Error("Scoped paired computer target was replaced or revoked");
    }
  };
  const assertAuthorized = () => {
    assertSourceCurrent();
    assertResourceCurrent();
  };
  assertAuthorized();
  // Teardown may outlive input permission, but can only close an execution this
  // transport admitted on this exact physical pairing and connection.
  const closeRequest = runWithGatewayToolCleanupContext(
    () => bindAgentToolGatewayRequest({ resolveGatewayContext: resolveContext, hostedOnly: true }),
    resolveContext,
  );
  const executions = new Set<string>();
  const closes = new Map<string, Promise<unknown>>();
  const payload = (result: { payload: unknown }) => result.payload;
  const transport: ComputerToolTransport = Object.freeze({
    computerUse,
    async resolveNode(
      query: Parameters<ComputerToolTransport["resolveNode"]>[0],
      signal: Parameters<ComputerToolTransport["resolveNode"]>[1],
    ) {
      signal?.throwIfAborted();
      assertAuthorized();
      if (query !== undefined) {
        throw new Error("Scoped paired computer does not accept a node selector");
      }
      return { nodeId, computerUse };
    },
    async invoke(request: Parameters<ComputerToolTransport["invoke"]>[0]) {
      if (
        request.nodeId !== nodeId ||
        (request.command !== COMPUTER_ACT_COMMAND && request.command !== SCREEN_SNAPSHOT_COMMAND)
      ) {
        throw new Error("Scoped paired computer invocation changed its target or command");
      }
      const executionId = request.commandParams.executionId;
      if (typeof executionId !== "string" || !executionId.trim()) {
        throw new Error("Scoped paired computer requires an execution ID");
      }
      if (
        request.command === COMPUTER_ACT_COMMAND &&
        request.commandParams.action === "__close_execution"
      ) {
        const existing = closes.get(executionId);
        if (existing) {
          return await existing;
        }
        if (!executions.has(executionId)) {
          throw new Error("Scoped paired computer cannot close an unowned execution");
        }
        assertResourceCurrent();
        const closing = closeRequest<{ payload: unknown }>({
          method: "node.invoke",
          params: {
            nodeId,
            command: COMPUTER_ACT_COMMAND,
            params: {
              action: "__close_execution",
              executionId,
              reason:
                typeof request.commandParams.reason === "string"
                  ? request.commandParams.reason.slice(0, 64)
                  : "completed",
            },
            idempotencyKey: `computer.close:${executionId}:node:${nodeId}`,
          },
          assertDispatchCurrent: assertResourceCurrent,
        }).then(payload);
        closes.set(executionId, closing);
        return await closing;
      }
      request.signal?.throwIfAborted();
      assertAuthorized();
      if (closes.has(executionId)) {
        throw new Error("Scoped paired computer execution is closed");
      }
      executions.add(executionId);
      const signals = [options.signal, request.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      );
      const result = await callGatewayTool<{ payload: unknown }>(
        "node.invoke",
        {},
        {
          nodeId,
          command: request.command,
          params: request.commandParams,
          timeoutMs: request.timeoutMs,
          idempotencyKey: request.idempotencyKey ?? crypto.randomUUID(),
        },
        {
          requireAgentRuntimeIdentity: true,
          signal: signals.length ? AbortSignal.any(signals) : undefined,
          dispatchAuthority: { version: 2, kind: "source-bound", assertCurrent: assertAuthorized },
        },
      );
      assertAuthorized();
      return payload(result);
    },
  });
  scopedTransports.add(transport);
  return transport;
}
