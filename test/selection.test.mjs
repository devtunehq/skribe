import assert from "node:assert/strict";
import test from "node:test";

import { markdownRangeFromPlainRange, renderedMarkdownSnippet, wrapPlainRangeWithMarkdownLink, wrapTableCellPlainRangeWithMarkdownLink } from "../src/markdownRanges.ts";
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

test("linking selected table text wraps that cell even when whole-table offsets are wrong", () => {
  const markdown = [
    "| Example | What customers pay for |",
    "| --- | --- |",
    "| Grafana Cloud | Managed observability services for metrics and visualisation. |",
    "| ClickHouse Cloud | Operating and maintaining PostgreSQL as a managed database service. |"
  ].join("\n");

  // Offsets as if the DOM concatenated cell text and skipped table pipes/separators —
  // those land in the Grafana description, which is the reported bug.
  const wrongStart = markdown.indexOf("metrics");
  const linked = wrapPlainRangeWithMarkdownLink(
    markdown,
    wrongStart,
    wrongStart + "ClickHouse Cloud".length,
    "ClickHouse Cloud",
    "https://clickhouse.com"
  );
  assert.match(linked ?? "", /\| \[ClickHouse Cloud\]\(https:\/\/clickhouse\.com\) \|/);
  assert.doesNotMatch(linked ?? "", /metric\[ClickHouse Cloud\]/);

  const cellLinked = wrapTableCellPlainRangeWithMarkdownLink(
    markdown,
    2,
    0,
    0,
    "ClickHouse Cloud".length,
    "ClickHouse Cloud",
    "https://clickhouse.com"
  );
  const parsed = cellLinked?.split("\n") ?? [];
  assert.match(parsed[3] ?? "", /\[ClickHouse Cloud\]\(https:\/\/clickhouse\.com\)/);
  assert.match(parsed[2] ?? "", /Managed observability services for metrics and visualisation\./);
});

test("linking duplicate table cell text wraps the selected cell, not the first match", () => {
  const markdown = "| A | B |\n| --- | --- |\n| N/A | first |\n| N/A | second |";
  const linked = wrapTableCellPlainRangeWithMarkdownLink(markdown, 2, 0, 0, 3, "N/A", "https://example.com");
  const rows = linked?.split("\n") ?? [];
  assert.match(rows[2] ?? "", /\| N\/A \| first \|/);
  assert.match(rows[3] ?? "", /\| \[N\/A\]\(https:\/\/example\.com\) \| second \|/);
});
