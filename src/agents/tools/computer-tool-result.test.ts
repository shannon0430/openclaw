import { describe, expect, it } from "vitest";
import { getImageMetadata } from "../../media/image-ops.js";
import { createSolidPngBuffer } from "../../plugin-sdk/test-helpers/image-fixtures.js";
import { parseComputerActResult } from "../../plugins/computer-use-contract.js";
import { projectComputerActResult, projectScreenshotResult } from "./computer-tool-result.js";

describe("computer screenshot dimensions", () => {
  it.each([
    [1024, 768, 1200, 1024, 768, true],
    [1080, 1920, 1280, 720, 1280, true],
    [1200, 1243, 1200, 1158, 1200, true],
    [1, 3, 1, 1, 1, true],
    [32, 16, 1200, 32, 16, false],
  ] as const)(
    "reports %dx%d at cap %d as the delivered %dx%d image",
    async (width, height, referenceWidth, deliveredWidth, deliveredHeight, reportsDimensions) => {
      const { result } = await projectScreenshotResult({
        capture: {
          base64: createSolidPngBuffer(width, height, { r: 70, g: 125, b: 180 }).toString("base64"),
          mimeType: "image/png",
          displayFrameId: "display-frame",
          ...(reportsDimensions ? { width, height } : {}),
        },
        target: { host: "node", nodeId: "desktop-node", screenIndex: 0 },
        action: "screenshot",
        noteLines: [],
        referenceWidth,
      });
      const image = result.content.find((block) => block.type === "image");
      if (!image) {
        throw new Error("The screenshot image is missing");
      }
      const metadata = await getImageMetadata(Buffer.from(image.data, "base64"));
      expect(metadata).toMatchObject({ width: deliveredWidth, height: deliveredHeight });
      expect(result.details).toMatchObject({
        width: deliveredWidth,
        height: deliveredHeight,
        refWidth: referenceWidth,
      });
      expect(result.content).toContainEqual({
        type: "text",
        text: expect.stringContaining(`screenshot ${deliveredWidth}x${deliveredHeight}`),
      });
    },
  );
});

describe("computer action verification scope", () => {
  it.each(["confirmed", "unverifiable"] as const)(
    "keeps %s native action scope separate from a successful follow-up observation",
    async (effect) => {
      const details = {
        route: "accessibility",
        nativeActionVerification: {
          scope: "native_action",
          ...(effect === "confirmed" ? { valueReadbackScope: "control_property" } : {}),
        },
        applicationOutcome: { commit: "not_evaluated", persistence: "not_evaluated" },
        ...(effect === "confirmed" ? { evidence: ["value_readback"] } : {}),
      };
      const producer = parseComputerActResult({ ok: true, effect, details });
      const followUp = parseComputerActResult({
        ok: true,
        details: { observedValue: "" },
      });
      const { result } = await projectComputerActResult({
        result: followUp,
        precedingAction: { action: "type", result: producer },
        target: { host: "node", nodeId: "desktop-node", screenIndex: 0 },
        action: "get_window_state",
        referenceWidth: 1200,
      });
      const texts = result.content.flatMap((block) =>
        block.type === "text" ? [JSON.parse(block.text) as Record<string, unknown>] : [],
      );
      expect(texts).toEqual([
        { action: "type", ok: true, effect, details },
        { action: "get_window_state", ok: true, details: { observedValue: "" } },
      ]);
      expect(result.details).toMatchObject({
        result: producer,
        followUpObservation: followUp,
      });
      expect(followUp).not.toHaveProperty("effect");
    },
  );
});
