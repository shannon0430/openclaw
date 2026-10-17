import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";
import { withPluginRuntimeGatewayContextResolver } from "../plugins/runtime/gateway-request-scope.js";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createOperationalRunInstanceRef } from "./admitted-run-context.js";
import { createOpenClawCodingTools } from "./agent-tools.js";
import { prepareScopedPairedComputerTransport } from "./scoped-paired-computer.js";
import type { ComputerToolTransport } from "./tools/computer-tool-shared.js";
import { withGatewayToolCallerIdentity } from "./tools/gateway-caller-context.js";

const pairingCurrent = vi.hoisted(() => vi.fn());
vi.mock("../infra/device-pairing-node-state.js", () => ({
  isPairedDeviceNodeBindingCurrent: pairingCurrent,
}));

const identity = {
  sessionKey: "agent:business:slack:dm:guest",
  sessionId: "conversation",
  agentId: "business",
};
const granted: OpenClawConfig = {
  agents: { entries: { business: { tools: { alsoAllow: ["computer"] } } } },
};

function assemble(
  transport?: ComputerToolTransport | null,
  config = granted,
  senderIsOwner = false,
) {
  return createOpenClawCodingTools({
    ...identity,
    config,
    senderIsOwner,
    modelHasVision: true,
    computerTransport: transport,
  });
}

async function withScopedDesktop<T>(run: (transport: ComputerToolTransport) => T | Promise<T>) {
  const node = {
    nodeId: "approved-desktop",
    connId: "approved-connection",
    pairingIdentity: "approved-pairing",
    pairingGeneration: "approved-generation",
    commands: ["computer.act", "screen.snapshot"],
    client: { invalidated: false },
  };
  const context = {
    nodeRegistry: { listCurrentConnected: async () => [node], get: () => node },
  } as unknown as GatewayRequestContext;
  return await withPluginRuntimeGatewayContextResolver(
    () => context,
    () =>
      withGatewayToolCallerIdentity(
        {
          ...identity,
          operationalRunInstance: createOperationalRunInstanceRef("business-run"),
          receiptAuthority: () => true,
          gatewayContextResolver: () => context,
        },
        async () => {
          const transport = await prepareScopedPairedComputerTransport({
            assertCurrent: () => {},
            canUseComputer: () => true,
          });
          expect(transport).toBeDefined();
          return await run(transport!);
        },
      ),
  );
}

beforeEach(() => {
  pairingCurrent.mockReturnValue(true);
});

describe("registered scoped computer surface", () => {
  it("publishes standard direct computer without delegating node or Gateway administration", async () => {
    await withScopedDesktop((transport) => {
      const tools = assemble(transport);
      const computer = tools.find((tool) => tool.name === "computer");
      expect(computer).toBeDefined();
      expect(computer?.catalogMode).toBe("direct-only");
      expect(computer?.parameters).toHaveProperty("properties.action");
      for (const selector of ["target", "node", "environmentId", "gatewayUrl", "gatewayToken"]) {
        expect(computer?.parameters).not.toHaveProperty(`properties.${selector}`);
      }
      for (const adminTool of ["nodes", "gateway", "screen", "mobile_ui", "terminal"]) {
        expect(tools.some((tool) => tool.name === adminTool)).toBe(false);
      }
    });
  });

  it("requires both the real host-issued transport and an explicit per-agent grant", async () => {
    await withScopedDesktop((transport) => {
      expect(assemble({ ...transport }).some((tool) => tool.name === "computer")).toBe(false);
      expect(
        assemble(transport, { tools: { profile: "full" } }).some(
          (tool) => tool.name === "computer",
        ),
      ).toBe(false);
      expect(
        assemble(transport, { tools: { alsoAllow: ["computer"] } }).some(
          (tool) => tool.name === "computer",
        ),
      ).toBe(false);
      expect(assemble(undefined).some((tool) => tool.name === "computer")).toBe(false);
      expect(assemble(null).some((tool) => tool.name === "computer")).toBe(false);
    });
  });

  it("continues to honor configured denies for a host-qualified non-owner", async () => {
    await withScopedDesktop((transport) => {
      expect(
        assemble(transport, { ...granted, tools: { deny: ["computer"] } }).some(
          (tool) => tool.name === "computer",
        ),
      ).toBe(false);
    });
  });

  it.each(["target", "node", "environmentId", "gatewayUrl", "gatewayToken"])(
    "rejects a raw %s selector, including a blank value, before target resolution",
    async (selector) => {
      await withScopedDesktop(async (transport) => {
        const computer = assemble(transport).find((tool) => tool.name === "computer")!;
        expect(() =>
          computer.prepareArguments?.({ action: "list_windows", [selector]: "" }),
        ).toThrow("host-approved paired node");
        await expect(
          computer.execute("retarget-attempt", { action: "list_windows", [selector]: "" }),
        ).rejects.toThrow("host-approved paired node");
      });
    },
  );

  it("preserves the owner's paired/Gateway selection schema", () => {
    const computer = assemble(undefined, granted, true).find((tool) => tool.name === "computer");
    expect(computer).toBeDefined();
    expect(computer?.parameters).toHaveProperty("properties.target");
    expect(computer?.parameters).toHaveProperty("properties.node");
    expect(computer?.parameters).toHaveProperty("properties.gatewayUrl");
  });
});
