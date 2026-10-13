import { describe, expect, it } from "vitest";
import {
  CUA_DRIVER_CONTRACT_FIXTURES,
  cuaToolResult,
} from "./cua-driver-contract.test-fixtures.js";
import type { CuaToolResult } from "./driver-client.js";
import { actionEnvelope, browserObservation, windowObservation } from "./driver-result.js";
import { issueWindowRef } from "./frame.js";

const observations = [
  { kind: "window", mimeType: "image/png", fields: CUA_DRIVER_CONTRACT_FIXTURES.windowState },
  { kind: "zoom", mimeType: "image/jpeg", fields: { width: 300, height: 200, format: "jpeg" } },
  { kind: "browser", mimeType: "image/png", fields: CUA_DRIVER_CONTRACT_FIXTURES.browserSnapshot },
] as const;

function project(kind: (typeof observations)[number]["kind"], result: CuaToolResult) {
  const state = { generation: "test-generation" };
  return kind === "browser"
    ? browserObservation(result, state, {
        browserRef: "test-browser",
        pageRef: "test-page",
        targetId: CUA_DRIVER_CONTRACT_FIXTURES.browserSnapshot.target_id,
        tabId: CUA_DRIVER_CONTRACT_FIXTURES.browserSnapshot.tab_id,
      })
    : windowObservation(result, state, issueWindowRef(state, { pid: 4242, windowId: 99 }), {
        fromZoom: kind === "zoom",
      });
}

describe.each(observations)("CUA $kind observation images", ({ kind, mimeType, fields }) => {
  it("keeps an observation without inventing an image when capture is absent", () => {
    const result = project(kind, cuaToolResult(fields));
    expect(result.observation?.observationId).toMatch(/^cua:v2:observation:/);
    expect(result.observation).not.toHaveProperty("base64");
    expect(result.observation).not.toHaveProperty("format");
  });

  it("rejects malformed base64 for the supported image format", () => {
    const result = cuaToolResult(fields);
    result.images = [{ mimeType, dataBase64: "invalid base64!" }];
    expect(() => project(kind, result)).toThrow("COMPUTER_DRIVER_ERROR");
  });
});

describe("CUA native action verification scope", () => {
  it("keeps confirmed control readback distinct from application commit and persistence", () => {
    const native = cuaToolResult(
      {},
      {
        action: {
          ...CUA_DRIVER_CONTRACT_FIXTURES.confirmedBackgroundAction,
          evidence: [
            {
              kind: 0,
              target: "fixture-private-native-control",
              value: "fixture-private-native-value",
            },
          ],
        } as unknown as CuaToolResult["action"],
      },
    );

    const result = actionEnvelope(native);

    expect(result).toEqual({
      ok: true,
      effect: "confirmed",
      details: {
        route: "accessibility",
        deliveryMode: "background",
        deliveredCount: 1,
        evidence: ["value_readback"],
        nativeActionVerification: {
          scope: "native_action",
          valueReadbackScope: "control_property",
        },
        applicationOutcome: { commit: "not_evaluated", persistence: "not_evaluated" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("fixture-private-native");
  });

  it("does not call a confirmed window change a control-property readback", () => {
    const result = actionEnvelope(
      cuaToolResult(
        {},
        {
          action: {
            ...CUA_DRIVER_CONTRACT_FIXTURES.confirmedBackgroundAction,
            evidence: [{ kind: 1 }],
          } as unknown as CuaToolResult["action"],
        },
      ),
    );

    expect(result.effect).toBe("confirmed");
    expect(result.details).toMatchObject({ evidence: ["window_change"] });
    expect(result.details?.nativeActionVerification).toEqual({ scope: "native_action" });
    expect(result.details?.applicationOutcome).toEqual({
      commit: "not_evaluated",
      persistence: "not_evaluated",
    });
  });

  it.each([
    { nativeEffect: 1, effect: "unverifiable", partial: true },
    { nativeEffect: 2, effect: "unverifiable", partial: false },
    { nativeEffect: 3, effect: "suspected_noop", partial: false },
  ])(
    "does not promote native effect $nativeEffect to an application verdict",
    ({ nativeEffect, effect, partial }) => {
      const result = actionEnvelope(
        cuaToolResult(
          {},
          {
            action: {
              effect: nativeEffect,
              route: 1,
              delivery: { mode: 0, deliveredCount: 0 },
            } as unknown as CuaToolResult["action"],
          },
        ),
      );

      expect(result).toMatchObject({
        ok: true,
        effect,
        details: { route: "synthetic_events", deliveryMode: "background", deliveredCount: 0 },
      });
      expect(result.details?.nativeActionVerification).toEqual({ scope: "native_action" });
      expect(result.details?.applicationOutcome).toEqual({
        commit: "not_evaluated",
        persistence: "not_evaluated",
      });
      expect(result.details).not.toHaveProperty("evidence");
      if (partial) {
        expect(result.details).toHaveProperty("partial", true);
      } else {
        expect(result.details).not.toHaveProperty("partial");
      }
    },
  );

  it("does not invent native certainty when action metadata is absent", () => {
    expect(actionEnvelope(cuaToolResult({}))).toEqual({
      ok: true,
      details: { applicationOutcome: { commit: "not_evaluated", persistence: "not_evaluated" } },
    });
  });

  it.each(["target_destroyed", "target_retained", "fixture-private-detail"])(
    "projects only finite native lifecycle evidence without upgrading the application effect (%s)",
    (detail) => {
      const native = cuaToolResult(
        {},
        {
          action: {
            effect: 2,
            route: 2,
            delivery: { mode: 1, deliveredCount: 2 },
            evidence: [{ kind: 1 }],
          } as unknown as CuaToolResult["action"],
        },
      );
      native.rawJson = JSON.stringify({
        nativeActionLifecycle: { targetTransition: detail },
        structuredContent: { effect: "unverifiable" },
      });
      const result = actionEnvelope(native, {
        nativeActionVerification: { targetTransition: "forged" },
      });
      expect(result).toMatchObject({
        ok: true,
        effect: "unverifiable",
        details: {
          deliveredCount: 2,
          applicationOutcome: { commit: "not_evaluated", persistence: "not_evaluated" },
        },
      });
      expect(result.details?.nativeActionVerification).toEqual({
        scope: "native_action",
        ...(detail.startsWith("target_") ? { targetTransition: detail } : {}),
      });
      expect(JSON.stringify(result)).not.toContain("fixture-private-detail");
      expect(JSON.stringify(result)).not.toContain("forged");
    },
  );

  it.each([true, false])(
    "keeps reserved verification fields honest with native metadata=%s",
    (hasNativeAction) => {
      const result = actionEnvelope(
        cuaToolResult(
          {},
          {
            action: hasNativeAction
              ? (CUA_DRIVER_CONTRACT_FIXTURES.confirmedBackgroundAction as unknown as CuaToolResult["action"])
              : undefined,
          },
        ),
        {
          coordinateSpace: "image-pixels",
          nativeActionVerification: { scope: "application", valueReadbackScope: "persisted_cell" },
          applicationOutcome: { commit: "confirmed", persistence: "confirmed" },
        },
      );

      expect(result.details).toHaveProperty("coordinateSpace", "image-pixels");
      if (hasNativeAction) {
        expect(result.details?.nativeActionVerification).toEqual({
          scope: "native_action",
          valueReadbackScope: "control_property",
        });
        expect(result.effect).toBe("confirmed");
      } else {
        expect(result.details).not.toHaveProperty("nativeActionVerification");
        expect(result).not.toHaveProperty("effect");
      }
      expect(result.details?.applicationOutcome).toEqual({
        commit: "not_evaluated",
        persistence: "not_evaluated",
      });
    },
  );
});
