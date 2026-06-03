import { markdownBlockIdFromIndex } from "./document.ts";
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

    const codeFence = trimmed.match(/^```(\w+)?/);
    if (codeFence) {
      flushParagraph(index - 1);
      const startIndex = index;
      const language = codeFence[1] ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
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

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const quote = trimmed.match(/^>\s?(.+)$/);

    if (heading || ordered || unordered || quote) {
      flushParagraph(index - 1);
      if (heading) {
        const start = textOffset(index, heading[2]);
        pushSpan({ type: "heading", level: heading[1].length, text: heading[2] }, index + 1, index + 1, start, start + heading[2].length);
      } else if (ordered) {
        const start = textOffset(index, ordered[2]);
        pushSpan({ type: "ordered-list", marker: ordered[1], text: ordered[2] }, index + 1, index + 1, start, start + ordered[2].length);
      } else if (unordered) {
        const start = textOffset(index, unordered[1]);
        pushSpan({ type: "unordered-list", text: unordered[1] }, index + 1, index + 1, start, start + unordered[1].length);
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
