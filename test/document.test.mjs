import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOutline,
  looksLikeMarkdownPaste,
  markdownBlockIdFromIndex,
  normalizeMarkdownPaste,
  parseMarkdownImage,
  parseMarkdownBlocks,
  parseMarkdownTable,
  reconcileBlockIds,
  serializeMarkdownBlocks,
  shouldPasteAsMarkdownBlocks,
  spliceMarkdownPaste,
  updateMarkdownBlock
} from "../src/document.ts";
import { getMarkdownBlockLineSpans } from "../src/markdownRanges.ts";

test("an empty document can become editable Markdown through the virtual first block", () => {
  const emptyBlockId = markdownBlockIdFromIndex(0);

  assert.deepEqual(parseMarkdownBlocks(""), []);
  assert.equal(updateMarkdownBlock("", emptyBlockId, "First line"), "First line\n");
  assert.equal(updateMarkdownBlock("\n", emptyBlockId, "First line"), "First line\n");
});

test("empty list items round-trip so a freshly split item survives", () => {
  const unordered = parseMarkdownBlocks("- First\n- \n- Third");
  assert.deepEqual(
    unordered.map((block) => [block.type, block.text]),
    [
      ["unordered-list", "First"],
      ["unordered-list", ""],
      ["unordered-list", "Third"]
    ]
  );

  const ordered = parseMarkdownBlocks("1. First\n2.\n3. Third");
  assert.deepEqual(
    ordered.map((block) => [block.type, block.text]),
    [
      ["ordered-list", "First"],
      ["ordered-list", ""],
      ["ordered-list", "Third"]
    ]
  );

  // A line that is just a marker stays a list item, but text without the space
  // separator is still a paragraph.
  assert.equal(parseMarkdownBlocks("-")[0].type, "unordered-list");
  assert.equal(parseMarkdownBlocks("-nope")[0].type, "paragraph");
  assert.equal(parseMarkdownBlocks("*emphasis*")[0].type, "paragraph");
});

test("splitting a list item serializes into two sibling items", () => {
  // Mirrors splitListBlockAtCaret: one list block becomes two at the caret.
  const [item] = parseMarkdownBlocks("- Groceries: milk and eggs");
  const cut = "Groceries: milk".length;
  const next = serializeMarkdownBlocks([
    { ...item, text: item.text.slice(0, cut) },
    { ...item, text: item.text.slice(cut) }
  ]);
  // Each item is trimmed and re-parses as its own list item; consecutive list
  // items stay tight (single newline).
  assert.equal(next, "- Groceries: milk\n- and eggs\n");
  assert.deepEqual(
    parseMarkdownBlocks(next).map((block) => [block.type, block.text]),
    [
      ["unordered-list", "Groceries: milk"],
      ["unordered-list", "and eggs"]
    ]
  );
});

test("reconcileBlockIds carries stable ids through edits, inserts, deletes, and moves", () => {
  let counter = 0;
  const mint = () => `mint-${(counter += 1)}`;
  const withIds = (entries) => entries.map(([id, type, text]) => ({ id, type, text }));
  const reconcile = (previous, parsed) => reconcileBlockIds(previous, parsed, mint);

  // First load keeps positional ids.
  const first = parseMarkdownBlocks("# Title\n\nAlpha\n\nBeta");
  assert.deepEqual(reconcile([], first), first);

  const base = withIds([
    ["id-h", "heading", "Title"],
    ["id-a", "paragraph", "Alpha"],
    ["id-b", "paragraph", "Beta"]
  ]);

  // Editing a block's text keeps its id (matched by type + position).
  const edited = reconcile(base, withIds([
    ["block-0", "heading", "Title"],
    ["block-1", "paragraph", "Alpha edited"],
    ["block-2", "paragraph", "Beta"]
  ]));
  assert.deepEqual(edited.map((b) => b.id), ["id-h", "id-a", "id-b"]);

  // Inserting a block shifts the others but they keep their ids; the new one is minted.
  const inserted = reconcile(base, withIds([
    ["block-0", "heading", "Title"],
    ["block-1", "paragraph", "Inserted"],
    ["block-2", "paragraph", "Alpha"],
    ["block-3", "paragraph", "Beta"]
  ]));
  assert.deepEqual(inserted.map((b) => b.text), ["Title", "Inserted", "Alpha", "Beta"]);
  assert.deepEqual(inserted.map((b) => b.id), ["id-h", "mint-1", "id-a", "id-b"]);

  // Deleting the middle block leaves the survivors' ids intact.
  const deleted = reconcile(base, withIds([
    ["block-0", "heading", "Title"],
    ["block-1", "paragraph", "Beta"]
  ]));
  assert.deepEqual(deleted.map((b) => b.id), ["id-h", "id-b"]);

  // Moving a block (reorder) preserves ids by signature match.
  const moved = reconcile(base, withIds([
    ["block-0", "heading", "Title"],
    ["block-1", "paragraph", "Beta"],
    ["block-2", "paragraph", "Alpha"]
  ]));
  assert.deepEqual(moved.map((b) => b.id), ["id-h", "id-b", "id-a"]);

  // Reformatting a block in place (paragraph -> heading) keeps its id via the
  // position-match pass, even though type and text both changed.
  const reformatted = reconcile(base, withIds([
    ["block-0", "heading", "Title"],
    ["block-1", "heading", "Alpha"],
    ["block-2", "paragraph", "Beta"]
  ]));
  assert.deepEqual(reformatted.map((b) => b.id), ["id-h", "id-a", "id-b"]);
});

test("code blocks containing a fence round-trip with a longer outer fence", () => {
  const block = { id: "block-0", type: "code", text: "```\nnested fence\n```", language: "md" };
  const markdown = serializeMarkdownBlocks([block]);
  assert.match(markdown, /^````md\n/, "should open with a 4-backtick fence");

  const parsed = parseMarkdownBlocks(markdown);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, "code");
  assert.equal(parsed[0].text, "```\nnested fence\n```");
});

test("markdown paste helpers detect and normalize Markdown blocks", () => {
  const markdown = "# Heading\r\n\r\n| A | B |\r\n| --- | --- |\r\n| one | two |";

  assert.equal(looksLikeMarkdownPaste(markdown), true);
  assert.equal(shouldPasteAsMarkdownBlocks(markdown), true);
  assert.equal(normalizeMarkdownPaste(markdown), "# Heading\n\n| A | B |\n| --- | --- |\n| one | two |");
});

test("standalone Markdown images become editable image blocks", () => {
  const markdown = "# Draft\n\n![Architecture diagram](assets/diagram.png)\n\nBody.";
  const blocks = parseMarkdownBlocks(markdown);

  assert.equal(blocks[1].type, "image");
  assert.deepEqual(parseMarkdownImage(blocks[1].text), {
    alt: "Architecture diagram",
    src: "assets/diagram.png",
    title: undefined
  });
  assert.equal(shouldPasteAsMarkdownBlocks("![Screenshot](draft.assets/screenshot.png)"), true);
  assert.equal(serializeMarkdownBlocks(blocks), "# Draft\n\n![Architecture diagram](assets/diagram.png)\n\nBody.\n");
});

test("outline extraction keeps heading order and ignores deep headings", () => {
  const markdown = [
    "# Product strategy",
    "",
    "Opening.",
    "",
    "## Activation",
    "",
    "### Retention loops",
    "",
    "#### Implementation detail",
    "",
    "## Pricing"
  ].join("\n");

  assert.deepEqual(extractOutline(markdown), [
    { id: "block-0", level: 1, title: "Product strategy" },
    { id: "block-2", level: 2, title: "Activation" },
    { id: "block-3", level: 3, title: "Retention loops" },
    { id: "block-5", level: 2, title: "Pricing" }
  ]);
});

test("markdown tables preserve alignment and escaped pipe markers", () => {
  const table = parseMarkdownTable([
    "| Metric | Result | Notes |",
    "| :--- | ---: | :---: |",
    "| Activation | 42% | handles escaped \\| pipes |",
    "| Retention | 31% | trims cells |"
  ].join("\n"));

  assert.deepEqual(table, {
    headers: ["Metric", "Result", "Notes"],
    rows: [
      ["Activation", "42%", "handles escaped \\\\| pipes"],
      ["Retention", "31%", "trims cells"]
    ],
    alignments: ["left", "right", "center"]
  });
});

test("markdown paste helpers splice block Markdown into the document", () => {
  assert.equal(spliceMarkdownPaste("", 0, 0, "# Heading\n\nBody", true), "# Heading\n\nBody\n");
  assert.equal(
    spliceMarkdownPaste("Before\n\nAfter\n", 7, 7, "- One\n- Two", true),
    "Before\n\n- One\n- Two\n\nAfter\n"
  );
  assert.equal(spliceMarkdownPaste("Before after\n", 7, 7, "**middle** ", false), "Before **middle** after\n");
});

test("block line spans stay in sync with parseMarkdownBlocks for long code fences", () => {
  // A 4+-backtick block containing a lone ``` line is one code block; the span
  // parser must close on the same fence length or its block count diverges and
  // selection/proposal anchoring drifts.
  const md = "Before.\n\n````\nline1\n```\nline2\n````\n\nAfter.\n";
  assert.equal(getMarkdownBlockLineSpans(md).length, parseMarkdownBlocks(md).length);
});

test("block line spans treat an empty list item as an empty-text block, not a paragraph", () => {
  const md = "Intro.\n\n- \n\nOutro.\n";
  const spans = getMarkdownBlockLineSpans(md);
  assert.equal(spans.length, parseMarkdownBlocks(md).length);
  // The middle block is an empty list item: its text span is empty, aligned with
  // the parsed empty block — not the whole "- " line.
  assert.equal(md.slice(spans[1].textStart, spans[1].textEnd), "");
});

test("mixed list types are separated by a blank line and round-trip as distinct lists", () => {
  const md = serializeMarkdownBlocks([
    { id: "block-0", type: "ordered-list", marker: "1", text: "one" },
    { id: "block-1", type: "unordered-list", text: "two" }
  ]);
  assert.match(md, /1\. one\n\n- two/);
  const reparsed = parseMarkdownBlocks(md);
  assert.equal(reparsed.length, 2);
  assert.equal(reparsed[0].type, "ordered-list");
  assert.equal(reparsed[1].type, "unordered-list");
});

test("same-type list items stay tight (single newline)", () => {
  const md = serializeMarkdownBlocks([
    { id: "block-0", type: "unordered-list", text: "one" },
    { id: "block-1", type: "unordered-list", text: "two" }
  ]);
  assert.equal(md, "- one\n- two\n");
});
