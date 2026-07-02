import { isThematicBreak, markdownBlockIdFromIndex } from "./document.ts";
import type { MarkdownBlockIdentity } from "./document.ts";

export interface MarkdownBlockLineSpan {
  id: string;
  startLine: number;
  endLine: number;
  textStart: number;
  textEnd: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function comparableText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function characterIndexForLine(markdown: string, lineNumber: number) {
  if (lineNumber <= 1) return 0;

  let currentLine = 1;
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "\n") continue;
    currentLine += 1;
    if (currentLine === lineNumber) return index + 1;
  }

  return markdown.length;
}

export function getMarkdownBlockLineSpans(markdown: string): MarkdownBlockLineSpan[] {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");
  const lineStarts: number[] = [];
  let cursor = 0;
  lines.forEach((line) => {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  });
  const spans: MarkdownBlockLineSpan[] = [];
  let paragraphStart: number | null = null;

  const lineStart = (lineIndex: number) => lineStarts[lineIndex] ?? normalizedMarkdown.length;
  const lineEnd = (lineIndex: number) => lineStart(lineIndex) + (lines[lineIndex]?.length ?? 0);
  const textOffset = (lineIndex: number, text: string) => {
    const index = lines[lineIndex]?.indexOf(text) ?? -1;
    return lineStart(lineIndex) + Math.max(index, 0);
  };
  let blockIndex = 0;

  const pushSpan = (
    _block: MarkdownBlockIdentity,
    startLine: number,
    endLine: number,
    textStart: number,
    textEnd: number
  ) => {
    spans.push({
      id: markdownBlockIdFromIndex(blockIndex),
      startLine,
      endLine,
      textStart,
      textEnd
    });
    blockIndex += 1;
  };

  const flushParagraph = (endIndex: number) => {
    if (paragraphStart === null) return;
    pushSpan(
      {
        type: "paragraph",
        text: lines.slice(paragraphStart, endIndex + 1).join("\n").trim()
      },
      paragraphStart + 1,
      Math.max(paragraphStart + 1, endIndex + 1),
      lineStart(paragraphStart),
      lineEnd(endIndex)
    );
    paragraphStart = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      flushParagraph(index - 1);
      continue;
    }

    const codeFence = trimmed.match(/^(`{3,})(\w+)?/);
    if (codeFence) {
      flushParagraph(index - 1);
      const startIndex = index;
      const fenceLength = codeFence[1].length;
      const language = codeFence[2] ?? "";
      const codeLines: string[] = [];
      index += 1;
      // Close only on a fence at least as long as the opener — matches
      // parseMarkdownBlocks so a 4+-backtick block containing a ``` line stays one
      // block and the spans keep the same block count.
      const isClosingFence = (line: string) => {
        const fence = line.trim();
        return /^`+$/.test(fence) && fence.length >= fenceLength;
      };
      while (index < lines.length && !isClosingFence(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      pushSpan(
        {
          type: "code",
          text: codeLines.join("\n"),
          language
        },
        startIndex + 1,
        Math.min(index + 1, lines.length),
        lineStart(startIndex + 1),
        codeLines.length > 0 ? lineEnd(index - 1) : lineStart(startIndex + 1)
      );
      continue;
    }

    const tableSeparator = (line: string) => {
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
      return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    };
    const tableRow = (line: string) =>
      line.trim().includes("|") && line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length >= 2;
    if (tableRow(lines[index] ?? "") && tableSeparator(lines[index + 1] ?? "")) {
      flushParagraph(index - 1);
      const startIndex = index;
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim() && tableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      pushSpan(
        {
          type: "table",
          text: tableLines.join("\n")
        },
        startIndex + 1,
        index + 1,
        lineStart(startIndex),
        lineEnd(index)
      );
      continue;
    }

    // Mirror parseMarkdownBlocks: a horizontal rule is its own (text-less) block, so
    // it must flush the paragraph and emit a span or the block counts diverge.
    if (isThematicBreak(trimmed)) {
      flushParagraph(index - 1);
      pushSpan({ type: "thematic-break", text: "" }, index + 1, index + 1, lineStart(index), lineStart(index));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    // Allow empty list items so the spans match parseMarkdownBlocks (which keeps
    // a freshly-created "- " / "1." item as its own block); otherwise an empty
    // item gets absorbed into an adjacent paragraph and the block counts diverge.
    const ordered = trimmed.match(/^(\d+)\.(?:\s+(.*))?$/);
    const unordered = trimmed.match(/^[-*](?:\s+(.*))?$/);
    const quote = trimmed.match(/^>\s?(.+)$/);

    if (heading || ordered || unordered || quote) {
      flushParagraph(index - 1);
      if (heading) {
        const start = textOffset(index, heading[2]);
        pushSpan({ type: "heading", level: heading[1].length, text: heading[2] }, index + 1, index + 1, start, start + heading[2].length);
      } else if (ordered) {
        const text = ordered[2] ?? "";
        const start = text ? textOffset(index, text) : lineEnd(index);
        pushSpan({ type: "ordered-list", marker: ordered[1], text }, index + 1, index + 1, start, start + text.length);
      } else if (unordered) {
        // Strip a `[ ]` / `[x]` task box so the span's text offset lands on the
        // visible text, matching the stripped block.text parseMarkdownBlocks emits.
        const itemText = unordered[1] ?? "";
        const task = itemText.match(/^\[([ xX])\](?:\s+(.*))?$/);
        const text = task ? task[2] ?? "" : itemText;
        const start = text ? textOffset(index, text) : lineEnd(index);
        pushSpan({ type: "unordered-list", text }, index + 1, index + 1, start, start + text.length);
      } else if (quote) {
        const start = textOffset(index, quote[1]);
        pushSpan({ type: "quote", text: quote[1] }, index + 1, index + 1, start, start + quote[1].length);
      }
      continue;
    }

    if (paragraphStart === null) paragraphStart = index;
  }

  flushParagraph(lines.length - 1);
  return spans;
}

export function renderedMarkdownSnippet(markdown: string) {
  return markdown
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, "$1")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, " ")
    .replace(/(^|\n)\s*(?:[-*]|\d+\.)\s+/g, " ")
    .replace(/(^|\n)\s*>\s?/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function visibleMarkdownCharacters(markdown: string) {
  const characters: Array<{
    sourceIndex: number;
    linkStart?: number;
    linkEnd?: number;
    linkLabelStart?: number;
    linkLabelEnd?: number;
  }> = [];

  for (let index = 0; index < markdown.length; index += 1) {
    const linkMatch = markdown.slice(index).match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      const label = linkMatch[1];
      const labelStart = index + 1;
      const labelEnd = labelStart + label.length;
      const linkEnd = index + linkMatch[0].length;
      for (let offset = 0; offset < label.length; offset += 1) {
        characters.push({
          sourceIndex: labelStart + offset,
          linkStart: index,
          linkEnd,
          linkLabelStart: labelStart,
          linkLabelEnd: labelEnd
        });
      }
      index = linkEnd - 1;
      continue;
    }

    const twoCharMarker = markdown.slice(index, index + 2);
    if (twoCharMarker === "**" || twoCharMarker === "__" || twoCharMarker === "~~") {
      index += 1;
      continue;
    }

    const char = markdown[index];
    if (char === "*" || char === "_" || char === "`") continue;
    characters.push({ sourceIndex: index });
  }

  return characters;
}

export function markdownRangeFromPlainRange(markdown: string, plainStart: number, plainEnd: number) {
  const characters = visibleMarkdownCharacters(markdown);
  if (plainStart < 0 || plainEnd <= plainStart || plainStart >= characters.length || plainEnd > characters.length) return null;

  const selectedCharacters = characters.slice(plainStart, plainEnd);
  let start = selectedCharacters[0].sourceIndex;
  let end = (selectedCharacters.at(-1)?.sourceIndex ?? start) + 1;
  const linkStart = selectedCharacters[0].linkStart;
  const linkEnd = selectedCharacters[0].linkEnd;

  if (
    linkStart !== undefined &&
    linkEnd !== undefined &&
    selectedCharacters.every((character) => character.linkStart === linkStart && character.linkEnd === linkEnd)
  ) {
    const linkCharacters = characters.filter((character) => character.linkStart === linkStart && character.linkEnd === linkEnd);
    if (
      selectedCharacters.length === linkCharacters.length &&
      selectedCharacters[0].sourceIndex === selectedCharacters[0].linkLabelStart &&
      selectedCharacters.at(-1)?.sourceIndex === (selectedCharacters[0].linkLabelEnd ?? 0) - 1
    ) {
      start = linkStart;
      end = linkEnd;
    }
  }

  return { start, end };
}

export function markdownOffsetFromPlainOffset(markdown: string, plainOffset: number, edge: "start" | "end") {
  const characters = visibleMarkdownCharacters(markdown);
  if (characters.length === 0) return 0;

  if (edge === "start") {
    if (plainOffset <= 0) return 0;
    if (plainOffset >= characters.length) return markdown.length;
    const character = characters[plainOffset];
    return character.linkStart !== undefined && character.sourceIndex === character.linkLabelStart
      ? character.linkStart
      : character.sourceIndex;
  }

  if (plainOffset <= 0) return 0;
  if (plainOffset >= characters.length) return markdown.length;
  const character = characters[plainOffset - 1];
  return character.linkEnd !== undefined && character.sourceIndex === (character.linkLabelEnd ?? 0) - 1
    ? character.linkEnd
    : character.sourceIndex + 1;
}
