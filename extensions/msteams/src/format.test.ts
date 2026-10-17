import { describe, expect, it } from "vitest";
import { formatMSTeamsMarkdown } from "./format.js";

describe("formatMSTeamsMarkdown", () => {
  it.each([
    ["empty text", ""],
    ["headings and paragraphs", "# Status\n\n## Next\n\nReady.\n"],
    ["unordered and nested lists", "- alpha\n- beta\n    - child\n      - grandchild"],
    ["ordered lists", "3. alpha\n4. beta\n   1. child"],
    ["task lists", "- [x] shipped\n- [ ] pending"],
    ["intentional hard breaks", "first  \nsecond\\\nthird\n\nparagraph"],
    ["CRLF and indentation", "  first\r\n\r\nparagraph\t \r\n"],
    ["nested blockquotes", "> > **😀** `one`\n> > `two` **tail**\n\noutside"],
    ["fenced code and language", "````md\n```js\nconst x = '<br>';\n```\n````\n"],
    ["indented code", "    **literal code**\n\nnext"],
    ["inline code whitespace", "before `  foo  ` and ``value `with` ticks`` after"],
    ["escaping and entities", "\\*literal\\* \\`literal\\` &amp; &#42; <tag>"],
    ["links and images", "[link](https://example.com/a_(b)) ![plot](https://example.com/i.png)"],
    ["native mentions", "@[Alice \\[Ops\\]](29:abc) @[Sample](USER-ID)"],
    ["literal former placeholders", "\u{E000}msteamsformat-authored\u{E001}m0\u{E002}"],
  ])("preserves %s for Teams rendering", (_name, source) => {
    for (const mode of ["off", "code", "bullets"] as const) {
      expect(formatMSTeamsMarkdown(source, mode)).toBe(source);
    }
  });

  it("preserves raw table source when conversion is disabled", () => {
    const source = "# Status\r\n\r\n> | Name | State |\r\n> |---|---|\r\n> | deploy | ready |";
    expect(formatMSTeamsMarkdown(source, "off")).toBe(source);
  });

  it("converts only table ranges with the configured native bullet mode", () => {
    const before = "# Status\n\n- keep this list\n\n";
    const after = "\n\nfirst  \nsecond\n";
    const source = `${before}| A |\n| --- |\n| x |\n| y |${after}`;
    expect(formatMSTeamsMarkdown(source, "bullets")).toBe(`${before}• A: x\n\n• A: y${after}`);
  });

  it("uses native code-table conversion without rewriting surrounding Markdown", () => {
    const before = "# Status\n\n- keep this list\n\n";
    const after = "\n\nfirst  \nsecond\n";
    const rendered = formatMSTeamsMarkdown(`${before}| A |\n| --- |\n| x |${after}`, "code");
    expect(rendered.startsWith(`${before}\`\`\`\n`)).toBe(true);
    expect(rendered).toContain("| A");
    expect(rendered).toContain("| x");
    expect(rendered.endsWith(`\`\`\`${after}`)).toBe(true);
  });

  it.each(["code", "bullets"] as const)("keeps table-looking fenced code in %s mode", (mode) => {
    const source = "```md\n| A | B |\n|---|---|\n| x | y |\n```\n\n- next";
    expect(formatMSTeamsMarkdown(source, mode)).toBe(source);
  });
});
