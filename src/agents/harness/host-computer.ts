import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { OperationalRunInstanceRef } from "../admitted-run-context.js";
import { resolveConversationCapabilityProfile } from "../conversation-capability-profile.js";
import { buildEmbeddedAttemptToolRunContext } from "../embedded-agent-runner/run/attempt-tool-run-context.js";
import type { EmbeddedRunAttemptParams } from "../embedded-agent-runner/run/types.js";
import { hasScopedComputerPermission } from "../scoped-computer-policy.js";
import { prepareScopedPairedComputerTransport } from "../scoped-paired-computer.js";
import { resolveSessionPlacementComputer } from "../session-placement-computer.js";
import type { ComputerToolTransport } from "../tools/computer-tool-shared.js";
import { getInProcessGatewayToolContext } from "../tools/in-process-gateway.js";

/** Prepare once before a plugin harness serializes its host-owned catalog. */
export function createHarnessComputerPreparation(input: {
  attempt: Partial<EmbeddedRunAttemptParams>;
  config?: OpenClawConfig;
  operationalRunInstance: OperationalRunInstanceRef;
  assertCurrent: () => void;
  withCaller: <T>(run: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
}) {
  const { attempt, config, operationalRunInstance } = input;
  // Keep source facts private and capture them before the plugin handoff.
  const enabled =
    attempt.senderIsOwner === false &&
    !attempt.sandbox?.enabled &&
    attempt.disableTools !== true &&
    attempt.model?.input?.includes("image") === true;
  const signal = attempt.abortSignal;
  const policyContext = {
    ...buildEmbeddedAttemptToolRunContext(attempt),
    agentId: attempt.sandboxAgentId ?? attempt.agentId,
    sessionKey: attempt.sessionKey,
    sessionId: attempt.sessionId,
    runId: attempt.runId,
    messageProvider: attempt.messageProvider ?? attempt.messageChannel,
    messageChannel: attempt.messageChannel,
    conversationToolPolicy: attempt.conversationToolPolicy
      ? structuredClone(attempt.conversationToolPolicy)
      : undefined,
    modelProvider: attempt.model?.provider,
    modelId: attempt.model?.id,
    sandboxToolPolicy: attempt.sandbox?.tools ? structuredClone(attempt.sandbox.tools) : undefined,
    inheritRuntimeToolAllowlist: true,
  };
  let transport: ComputerToolTransport | undefined;
  let preparation: Promise<void> | undefined;
  return {
    transport: () => transport,
    prepare: async () => {
      input.assertCurrent();
      await (preparation ??= (async () => {
        input.assertCurrent();
        if (!enabled || resolveSessionPlacementComputer(operationalRunInstance) !== undefined) {
          return;
        }
        await input.withCaller(async () => {
          const canUseComputer = () => {
            input.assertCurrent();
            return hasScopedComputerPermission(
              resolveConversationCapabilityProfile({
                ...policyContext,
                config: getInProcessGatewayToolContext()?.getRuntimeConfig?.() ?? config,
              }),
            );
          };
          transport = await prepareScopedPairedComputerTransport({
            canUseComputer,
            assertCurrent: input.assertCurrent,
            signal,
          });
          input.assertCurrent();
        }, signal);
      })());
      input.assertCurrent();
    },
  };
}
