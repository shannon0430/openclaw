import type { ResolvedConversationCapabilityProfile } from "./conversation-capability-profile.js";
import { projectConversationToolNames } from "./conversation-tool-policy-pipeline.js";
import { collectExplicitAllowlist, normalizeToolPolicyName } from "./tool-policy.js";

/** A profile, wildcard, or run allowlist alone does not delegate a business desktop. */
export function hasScopedComputerPermission(
  profile: ResolvedConversationCapabilityProfile,
): boolean {
  const configured = collectExplicitAllowlist([
    profile.policy.sources.agent?.path?.startsWith("agents.defaults.")
      ? undefined
      : profile.policy.agentPolicy,
    profile.policy.sources.agentProvider?.path?.startsWith("agents.defaults.")
      ? undefined
      : profile.policy.agentProviderPolicy,
  ]);
  return (
    configured.some((name) => normalizeToolPolicyName(name) === "computer") &&
    projectConversationToolNames({
      capabilityProfile: profile,
      toolNames: ["computer"],
      warn: () => undefined,
    }).length === 1
  );
}
