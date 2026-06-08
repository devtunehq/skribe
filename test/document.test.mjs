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
  serializeMarkdownBlocks,
  shouldPasteAsMarkdownBlocks,
  spliceMarkdownPaste,
  updateMarkdownBlock
} from "../src/document.ts";

test("an empty document can become editable Markdown through the virtual first block", () => {
  const emptyBlockId = markdownBlockIdFromIndex(0);

  assert.deepEqual(parseMarkdownBlocks(""), []);
  assert.equal(updateMarkdownBlock("", emptyBlockId, "First line"), "First line\n");
  assert.equal(updateMarkdownBlock("\n", emptyBlockId, "First line"), "First line\n");
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
    "Before\n\n- One\n\n- Two\n\nAfter\n"
  );
  assert.equal(spliceMarkdownPaste("Before after\n", 7, 7, "**middle** ", false), "Before **middle** after\n");
});
