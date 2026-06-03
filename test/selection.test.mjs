import assert from "node:assert/strict";
import test from "node:test";

import { markdownRangeFromPlainRange, renderedMarkdownSnippet } from "../src/markdownRanges.ts";
import {
  buildSelectionFromMarkdownRange,
  deleteSelectionDraftFromMarkdown,
  resolveSelectionDraftRange
} from "../src/selection.ts";

test("plain text ranges over rendered links expand to the whole markdown link", () => {
  const markdown = "[Keycard.ai](https://www.keycard.ai/) is worth watching.";
  const range = markdownRangeFromPlainRange(markdown, 0, "Keycard.ai".length);

  assert.deepEqual(range, {
    start: 0,
    end: "[Keycard.ai](https://www.keycard.ai/)".length
  });
});

test("rendered markdown snippets remove formatting while preserving visible text", () => {
  assert.equal(
    renderedMarkdownSnippet("## Heading\n\n- **Keycard.ai** uses `OAuth` flows."),
    "Heading Keycard.ai uses OAuth flows."
  );
});

test("selection drafts resolve after whitespace changes around the selected text", () => {
  const markdown = "Before.\n\nTarget text with spacing.\n\nAfter.\n";
  const start = markdown.indexOf("Target");
  const draft = buildSelectionFromMarkdownRange(markdown, start, start + "Target text with spacing.".length);
  assert.ok(draft);

  const changedMarkdown = "Before.\n\nTarget text   with   spacing.\n\nAfter.\n";
  const range = resolveSelectionDraftRange(changedMarkdown, draft);

  assert.deepEqual(range, {
    start: changedMarkdown.indexOf("Target"),
    end: changedMarkdown.indexOf("Target text   with   spacing.") + "Target text   with   spacing.".length
  });
});

test("deleting a selection across blocks removes only the selected text", () => {
  const markdown = "First block start middle of first.\n\nSecond block start end of second.\n\nThird untouched.\n";
  const start = markdown.indexOf("middle of first");
  const end = markdown.indexOf("end of second.") + "end of second.".length;
  const draft = buildSelectionFromMarkdownRange(markdown, start, end);
  assert.ok(draft);

  const nextMarkdown = deleteSelectionDraftFromMarkdown(markdown, draft);

  assert.equal(nextMarkdown, "First block start\n\nThird untouched.\n");
});

test("deleting an entire selected block removes the block without leaving an empty placeholder", () => {
  const markdown = "Keep before.\n\nDelete this block.\n\nKeep after.\n";
  const start = markdown.indexOf("Delete this block.");
  const end = start + "Delete this block.".length;
  const draft = buildSelectionFromMarkdownRange(markdown, start, end);
  assert.ok(draft);

  const nextMarkdown = deleteSelectionDraftFromMarkdown(markdown, draft);

  assert.equal(nextMarkdown, "Keep before.\n\nKeep after.\n");
});
