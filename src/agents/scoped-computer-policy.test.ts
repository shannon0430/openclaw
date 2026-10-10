import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AgentToolsConfig } from "../config/types.tools.js";
import {
  resolveConversationCapabilityProfile,
  type ConversationCapabilityProfileParams,
} from "./conversation-capability-profile.js";
import { hasScopedComputerPermission } from "./scoped-computer-policy.js";

const sessionKey = "agent:business:slack:dm:guest";

function configuredAgent(tools: AgentToolsConfig): OpenClawConfig {
  return { agents: { entries: { business: { tools } } } };
}

function permission(params: ConversationCapabilityProfileParams) {
  return hasScopedComputerPermission(
    resolveConversationCapabilityProfile({
      agentId: "business",
      sessionKey,
      senderId: "guest",
      senderIsOwner: false,
      messageProvider: "slack",
      modelProvider: "fixture",
      inheritRuntimeToolAllowlist: true,
      ...params,
    }),
  );
}

describe("host-scoped paired computer permission", () => {
  it.each([
    { allow: ["computer"] },
    { alsoAllow: ["computer"] },
    { byProvider: { fixture: { alsoAllow: ["computer"] } } },
  ])("accepts an explicit grant on the selected agent: %j", (tools) => {
    expect(permission({ config: configuredAgent(tools) })).toBe(true);
  });

  it.each([
    { name: "unrestricted configuration", params: {} },
    { name: "full agent profile", params: { config: configuredAgent({ profile: "full" }) } },
    { name: "agent wildcard", params: { config: configuredAgent({ allow: ["*"] }) } },
    { name: "agent glob", params: { config: configuredAgent({ alsoAllow: ["comp*"] }) } },
    {
      name: "computer tool group",
      params: { config: configuredAgent({ alsoAllow: ["group:computer"] }) },
    },
    { name: "global allow", params: { config: { tools: { allow: ["computer"] } } } },
    { name: "global alsoAllow", params: { config: { tools: { alsoAllow: ["computer"] } } } },
    {
      name: "global provider grant",
      params: { config: { tools: { byProvider: { fixture: { alsoAllow: ["computer"] } } } } },
    },
    { name: "runtime-only grant", params: { runtimeToolAllowlist: ["computer"] } },
    {
      name: "another agent's grant",
      params: {
        config: {
          agents: { entries: { business: {}, other: { tools: { alsoAllow: ["computer"] } } } },
        },
      },
    },
    {
      name: "another provider's grant",
      params: { config: configuredAgent({ byProvider: { other: { alsoAllow: ["computer"] } } }) },
    },
  ] satisfies Array<{ name: string; params: ConversationCapabilityProfileParams }>)(
    "does not delegate a desktop from $name",
    ({ params }) => {
      expect(permission(params)).toBe(false);
    },
  );

  it("does not promote a legacy shared default to an explicit per-agent grant", () => {
    // Raw pre-roster SDK input remains valid policy input, but is not a desktop grant.
    const config = {
      agents: { defaults: { tools: { alsoAllow: ["computer"] } } },
    } as OpenClawConfig;
    expect(permission({ config })).toBe(false);
  });

  it.each([
    {
      name: "global deny",
      params: {
        config: { ...configuredAgent({ alsoAllow: ["computer"] }), tools: { deny: ["computer"] } },
      },
    },
    {
      name: "agent deny",
      params: { config: configuredAgent({ alsoAllow: ["computer"], deny: ["computer"] }) },
    },
    {
      name: "sender deny",
      params: {
        config: {
          ...configuredAgent({ alsoAllow: ["computer"] }),
          tools: { toolsBySender: { "id:guest": { deny: ["computer"] } } },
        },
      },
    },
    {
      name: "conversation deny",
      params: {
        config: configuredAgent({ alsoAllow: ["computer"] }),
        conversationToolPolicy: { deny: ["computer"] },
      },
    },
    {
      name: "sandbox deny",
      params: {
        config: configuredAgent({ alsoAllow: ["computer"] }),
        sandboxToolPolicy: { allow: ["*"], deny: ["computer"] },
      },
    },
    {
      name: "runtime cap",
      params: {
        config: configuredAgent({ alsoAllow: ["computer"] }),
        runtimeToolAllowlist: ["read"],
      },
    },
  ] satisfies Array<{ name: string; params: ConversationCapabilityProfileParams }>)(
    "preserves the $name above an explicit grant",
    ({ params }) => {
      expect(permission(params)).toBe(false);
    },
  );

  it("preserves a host-prepared inherited desktop deny", () => {
    const childKey = "agent:business:subagent:child";
    const parentKey = "agent:business:main";
    expect(
      permission({
        config: configuredAgent({ alsoAllow: ["computer"] }),
        sessionKey: childKey,
        preparedSessionCapabilityStore: {
          [childKey]: {
            sessionId: "child",
            spawnedBy: parentKey,
            inheritedToolPolicyVersion: 1,
            inheritedToolAllow: ["*"],
            inheritedToolDeny: ["computer"],
          },
          [parentKey]: { sessionId: "parent" },
        },
      }),
    ).toBe(false);
  });
});
