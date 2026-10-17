import { describe, expect, it } from "vitest";
import {
  buildMSTeamsAdaptiveCardActivity,
  buildMSTeamsMessageActivity,
} from "./message-activity.js";

const aiGeneratedEntity = {
  type: "https://schema.org/Message",
  "@type": "Message",
  "@context": "https://schema.org",
  "@id": "",
  additionalType: ["AIGeneratedContent"],
};

describe("buildMSTeamsMessageActivity", () => {
  it.each(["", "- alpha\n- beta\n\nfirst  \nsecond"])(
    "selects extended Markdown for text-bearing activities %j",
    (text) => {
      expect(buildMSTeamsMessageActivity(text)).toEqual({
        type: "message",
        text,
        textFormat: "extendedmarkdown",
        entities: [aiGeneratedEntity],
      });
    },
  );

  it("keeps native mentions paired with their text and AI metadata", () => {
    expect(buildMSTeamsMessageActivity("- @[Synthetic](29:abc)\n- next")).toEqual({
      type: "message",
      text: "- <at>Synthetic</at>\n- next",
      textFormat: "extendedmarkdown",
      entities: [
        {
          type: "mention",
          text: "<at>Synthetic</at>",
          mentioned: { id: "29:abc", name: "Synthetic" },
        },
        aiGeneratedEntity,
      ],
    });
  });

  it("retains documentation placeholders as ordinary text", () => {
    expect(buildMSTeamsMessageActivity("@[Sample](USER-ID)")).toEqual({
      type: "message",
      text: "@[Sample](USER-ID)",
      textFormat: "extendedmarkdown",
      entities: [aiGeneratedEntity],
    });
  });

  it("does not attach a text format to media-only activities", () => {
    expect(buildMSTeamsMessageActivity()).toEqual({
      type: "message",
      entities: [aiGeneratedEntity],
    });
  });

  it("keeps Adaptive Card activities independent of text formatting", () => {
    const card = { type: "AdaptiveCard", body: [{ type: "TextBlock", text: "a\nb" }] };
    expect(buildMSTeamsAdaptiveCardActivity(card)).toEqual({
      type: "message",
      attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
    });
  });
});
