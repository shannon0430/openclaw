import { convertMarkdownTables } from "openclaw/plugin-sdk/text-chunking";
import type { MarkdownTableMode } from "../runtime-api.js";

export function formatMSTeamsMarkdown(markdown: string, tableMode: MarkdownTableMode): string {
  // Teams extended Markdown owns list, paragraph, fence and hard-break rendering.
  if (markdown === "") {
    return markdown;
  }
  return convertMarkdownTables(markdown, tableMode);
}
