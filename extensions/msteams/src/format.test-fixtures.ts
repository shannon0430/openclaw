export const teamsQuotedRawTable =
  "> | Name | State |\r\n> |---|---|\r\n> | [deploy](https://host/a) | ready |";

export const teamsQuotedTableReply = {
  source: `# Status\r\n\r\n${teamsQuotedRawTable}\n\n# Next`,
  expected: `# Status\r\n\r\n${teamsQuotedRawTable}\n\n# Next`,
};

export const teamsMarkdownDeliveryCases = [
  { name: "plain text", source: "hello", expected: "hello" },
  {
    name: "structural lists and hard breaks",
    source: "# Status\n\n- alpha\n- beta\n  - child\n\nfirst  \nsecond\\\nthird",
    expected: "# Status\n\n- alpha\n- beta\n  - child\n\nfirst  \nsecond\\\nthird",
  },
  { name: "quoted CRLF table", ...teamsQuotedTableReply },
  {
    name: "table-looking code inside an open list fence",
    source: "- ```\n  code\n\n  > | A | B |\n  > |---|---|\n  > | x | y |",
    expected: "- ```\n  code\n\n  > | A | B |\n  > |---|---|\n  > | x | y |",
  },
  {
    name: "raw table after list-fence outdent",
    source: "- ```\n  code\n\n> >   | A | B |\n> >   |---|---|\n> >   | x | y |",
    expected: "- ```\n  code\n\n> >   | A | B |\n> >   |---|---|\n> >   | x | y |",
  },
];
