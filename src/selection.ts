import { parseMarkdownBlocks, serializeMarkdownBlocks } from "./document.ts";
import {
  clamp,
  comparableText,
  getMarkdownBlockLineSpans,
  renderedMarkdownSnippet
} from "./markdownRanges.ts";
import type { SelectionDraft } from "./types.ts";

export function buildSelectionFromMarkdownRange(markdown: string, startIndex: number, endIndex: number): SelectionDraft | null {
  const start = clamp(Math.min(startIndex, endIndex), 0, markdown.length);
  const end = clamp(Math.max(startIndex, endIndex), 0, markdown.length);
  if (end <= start) return null;

  const exact = renderedMarkdownSnippet(markdown.slice(start, end));
  if (exact.length < 3) return null;

  return {
    kind: "markdown-range",
    exact,
    prefix: markdown.slice(Math.max(0, start - 120), start).replace(/\s+/g, " ").trim(),
    suffix: markdown.slice(end, end + 120).replace(/\s+/g, " ").trim(),
    start,
    end
  };
}

export function resolveSelectionDraftRange(markdown: string, draft: SelectionDraft) {
  const exact = comparableText(draft.exact);

  if (draft.kind === "markdown-range") {
    const start = clamp(draft.start, 0, markdown.length);
    const end = clamp(draft.end, start, markdown.length);
    const selected = comparableText(renderedMarkdownSnippet(markdown.slice(start, end)));
    if (selected && (selected === exact || selected.includes(exact))) {
      return { start, end };
    }
  }

  const directIndex = markdown.indexOf(draft.exact);
  if (directIndex >= 0) {
    return { start: directIndex, end: directIndex + draft.exact.length };
  }

  const pattern = draft.exact
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  if (!pattern) return null;

  const match = markdown.match(new RegExp(pattern));
  if (!match || match.index === undefined) return null;
  return { start: match.index, end: match.index + match[0].length };
}

export function deleteSelectionDraftFromMarkdown(markdown: string, draft: SelectionDraft) {
  if (draft.kind !== "markdown-range") return null;

  const range = resolveSelectionDraftRange(markdown, draft);
  if (!range || range.end <= range.start) return null;

  const blocks = parseMarkdownBlocks(markdown);
  const spans = getMarkdownBlockLineSpans(markdown);
  let changed = false;

  const nextBlocks = blocks.flatMap((block) => {
    const span = spans.find((item) => item.id === block.id);
    if (!span || range.end <= span.textStart || range.start >= span.textEnd) return [block];

    const start = clamp(range.start - span.textStart, 0, block.text.length);
    const end = clamp(range.end - span.textStart, start, block.text.length);
    if (end <= start) return [block];

    changed = true;
    const selectedEntireBlock = start === 0 && end >= block.text.length;
    if (selectedEntireBlock) return [];

    const text = `${block.text.slice(0, start)}${block.text.slice(end)}`;
    return text.trim() ? [{ ...block, text }] : [];
  });

  if (!changed) return null;
  const nextMarkdown = serializeMarkdownBlocks(nextBlocks);
  return nextMarkdown === markdown ? null : nextMarkdown;
}
