import type { ReviewThread, SelectionDraft } from "./types";

export type MarkdownBlockType =
  | "heading"
  | "paragraph"
  | "ordered-list"
  | "unordered-list"
  | "quote"
  | "code"
  | "table"
  | "image"
  | "thematic-break";

export interface MarkdownBlock {
  id: string;
  type: MarkdownBlockType;
  text: string;
  level?: number;
  marker?: string;
  language?: string;
  // Set only on task-list items (an unordered item written as `- [ ]` / `- [x]`);
  // undefined on every other unordered item, which keeps plain bullets bullets.
  checked?: boolean;
}

export interface MarkdownImage {
  alt: string;
  src: string;
  title?: string;
}

export type MarkdownBlockIdentity = Omit<MarkdownBlock, "id">;

function markdownBlockSignature(block: MarkdownBlockIdentity) {
  return [
    block.type,
    block.level ?? "",
    block.marker ?? "",
    block.language ?? "",
    block.checked === undefined ? "" : block.checked ? "checked" : "unchecked",
    block.text.replace(/\s+/g, " ").trim()
  ].join("\u001f");
}

export function markdownBlockIdFromIndex(index: number) {
  return `block-${index}`;
}

// Carry stable block ids forward across re-parses. Markdown has no place to
// persist ids, so `parseMarkdownBlocks` assigns positional ones; this reconciles
// a freshly parsed list against the previously reconciled list so a block that
// was merely edited, moved, or shifted by an insert/delete above keeps its id,
// and only genuinely new blocks receive fresh ids. This lets React keys, refs,
// the active block, and review/proposal anchors track content instead of array
// position. With no previous list (first load) the positional ids are kept.
export function reconcileBlockIds(
  previous: MarkdownBlock[],
  parsed: MarkdownBlock[],
  mintId: () => string
): MarkdownBlock[] {
  if (previous.length === 0) return parsed;

  const used = new Set<number>();
  const assigned: Array<string | null> = parsed.map(() => null);

  const nearestUnused = (target: number, eligible: (index: number) => boolean) => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < previous.length; index += 1) {
      if (used.has(index) || !eligible(index)) continue;
      const distance = Math.abs(index - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  };

  // Pass 1: exact signature match (type/level/marker/language/text), preferring
  // the previous block closest to this position — handles unchanged and moved
  // blocks.
  const previousSignatures = previous.map((block) => markdownBlockSignature(block));
  parsed.forEach((block, index) => {
    const signature = markdownBlockSignature(block);
    const match = nearestUnused(index, (candidate) => previousSignatures[candidate] === signature);
    if (match >= 0) {
      used.add(match);
      assigned[index] = previous[match].id;
    }
  });

  // Pass 2: same-type match by nearest position — handles in-place text edits.
  parsed.forEach((block, index) => {
    if (assigned[index] !== null) return;
    const match = nearestUnused(index, (candidate) => previous[candidate].type === block.type);
    if (match >= 0) {
      used.add(match);
      assigned[index] = previous[match].id;
    }
  });

  // Pass 3: nearest remaining by position regardless of type — keeps a block's
  // id when it is reformatted in place (e.g. heading -> paragraph), as long as the
  // block count is unchanged at that point.
  parsed.forEach((_block, index) => {
    if (assigned[index] !== null) return;
    const match = nearestUnused(index, () => true);
    if (match >= 0) {
      used.add(match);
      assigned[index] = previous[match].id;
    }
  });

  // Pass 4: genuinely new blocks get a fresh stable id.
  return parsed.map((block, index) => ({ ...block, id: assigned[index] ?? mintId() }));
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  const entropy = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${entropy}`;
}

export function titleFromMarkdown(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Untitled Draft";
}

export function buildSelection(markdown: string, selectedText: string): SelectionDraft {
  const exact = selectedText.replace(/\s+/g, " ").trim();
  const compactMarkdown = markdown.replace(/\s+/g, " ");
  const start = compactMarkdown.indexOf(exact);
  const safeStart = start >= 0 ? start : 0;
  const end = start >= 0 ? start + exact.length : exact.length;

  return {
    exact,
    prefix: compactMarkdown.slice(Math.max(0, safeStart - 80), safeStart),
    suffix: compactMarkdown.slice(end, end + 80),
    start: safeStart,
    end
  };
}

export function applySuggestion(markdown: string, original: string, replacement: string) {
  if (!original) return markdown;
  if (markdown.includes(replacement)) return markdown;

  const index = markdown.indexOf(original);
  if (index === -1) {
    const whitespaceFlexible = original.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const match = markdown.match(new RegExp(whitespaceFlexible));
    if (match && match.index !== undefined) {
      return `${markdown.slice(0, match.index)}${replacement}${markdown.slice(match.index + match[0].length)}`;
    }

    const renderedRange = findRenderedMarkdownRange(markdown, original);
    if (!renderedRange) return markdown;
    return `${markdown.slice(0, renderedRange.start)}${replacement}${markdown.slice(renderedRange.end)}`;
  }
  return `${markdown.slice(0, index)}${replacement}${markdown.slice(index + original.length)}`;
}

function findRenderedMarkdownRange(markdown: string, renderedNeedle: string) {
  const characters = renderedMarkdownCharacters(markdown);
  const renderedText = characters.map((character) => character.value).join("");
  const pattern = renderedNeedle
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  if (!pattern) return null;

  const match = renderedText.match(new RegExp(pattern));
  if (!match || match.index === undefined) return null;

  const firstCharacter = characters[match.index];
  const lastCharacter = characters[match.index + match[0].length - 1];
  if (!firstCharacter || !lastCharacter) return null;

  return {
    start:
      firstCharacter.linkStart !== undefined && firstCharacter.sourceIndex === firstCharacter.linkLabelStart
        ? firstCharacter.linkStart
        : firstCharacter.sourceIndex,
    end:
      lastCharacter.linkEnd !== undefined && lastCharacter.sourceIndex === (lastCharacter.linkLabelEnd ?? 0) - 1
        ? lastCharacter.linkEnd
        : lastCharacter.sourceIndex + 1
  };
}

function renderedMarkdownCharacters(markdown: string) {
  const characters: Array<{
    value: string;
    sourceIndex: number;
    linkStart?: number;
    linkEnd?: number;
    linkLabelStart?: number;
    linkLabelEnd?: number;
  }> = [];

  for (let index = 0; index < markdown.length; index += 1) {
    // Inline images have no rendered text, so contribute no characters — skip the
    // whole syntax before the link rule can match the "[alt](src)" tail.
    const imageMatch = markdown.slice(index).match(/^!\[[^\]\n]*\]\([^)\s]+\)/);
    if (imageMatch) {
      index += imageMatch[0].length - 1;
      continue;
    }

    const linkMatch = markdown.slice(index).match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      const label = linkMatch[1];
      const labelStart = index + 1;
      const labelEnd = labelStart + label.length;
      const linkEnd = index + linkMatch[0].length;
      for (let offset = 0; offset < label.length; offset += 1) {
        characters.push({
          value: label[offset],
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

    // An autolink <https://…> renders the URL as its visible text; map its
    // characters like a link label so the angle brackets don't shift offsets.
    const autolinkMatch = markdown.slice(index).match(/^<((?:https?|mailto):[^>\s]+)>/);
    if (autolinkMatch) {
      const url = autolinkMatch[1];
      const labelStart = index + 1;
      const labelEnd = labelStart + url.length;
      const linkEnd = index + autolinkMatch[0].length;
      for (let offset = 0; offset < url.length; offset += 1) {
        characters.push({
          value: url[offset],
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

    const twoCharacterMarker = markdown.slice(index, index + 2);
    if (twoCharacterMarker === "**" || twoCharacterMarker === "__" || twoCharacterMarker === "~~") {
      index += 1;
      continue;
    }

    const character = markdown[index];
    if (character === "*" || character === "_" || character === "`") continue;
    characters.push({ value: character, sourceIndex: index });
  }

  return characters;
}

export function extractOutline(markdown: string) {
  const outline: Array<{ id: string; level: number; title: string }> = [];
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type !== "heading" || (block.level ?? 1) > 3) continue;
    outline.push({
      id: block.id,
      level: block.level ?? 2,
      title: block.text.trim()
    });
  }
  return outline;
}

export function openThreads(threads: ReviewThread[]) {
  return threads.filter((thread) => thread.status === "open");
}

export function wordCount(markdown: string) {
  return markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      // Unescape: keep the escaped character, drop the backslash. Returning clean
      // (unescaped) cell values keeps parse -> serialize idempotent — serialization
      // is the single place that re-escapes, so pipes can't accrue backslashes on
      // repeated edits.
      cell += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function isTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && splitTableRow(trimmed).length >= 2;
}

function isTableSeparator(line: string) {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isTableStart(lines: string[], index: number) {
  return isTableRow(lines[index] ?? "") && isTableSeparator(lines[index + 1] ?? "");
}

export function isThematicBreak(line: string) {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim());
}

export function parseMarkdownImage(markdown: string): MarkdownImage | null {
  const match = markdown.trim().match(/^!\[([^\]\n]*)\]\((.*?)\)$/);
  if (!match) return null;

  const alt = match[1].replace(/\\\]/g, "]");
  let target = match[2].trim();
  if (!target) return null;

  let title: string | undefined;
  const titleMatch = target.match(/^(<[^>]+>|[^\s]+)\s+(?:"([^"]*)"|'([^']*)')$/);
  if (titleMatch) {
    target = titleMatch[1];
    title = titleMatch[2] ?? titleMatch[3];
  }

  const src = target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1).trim() : target;
  if (!src) return null;
  return { alt, src, title };
}

function serializeMarkdownImage(image: MarkdownImage) {
  const alt = image.alt.replace(/\]/g, "\\]");
  const src = /[\s)]/.test(image.src) ? `<${image.src}>` : image.src.replace(/\)/g, "%29");
  const title = image.title ? ` "${image.title.replace(/"/g, '\\"')}"` : "";
  return `![${alt}](${src}${title})`;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const pushBlock = (block: MarkdownBlockIdentity) => {
    blocks.push({
      id: markdownBlockIdFromIndex(blocks.length),
      ...block
    });
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    // A lone zero-width space marks a deliberately empty paragraph block (created
    // by pressing Enter at the end of a block). Keep it: it renders invisibly but
    // gives the empty contentEditable a focusable position, and the editor strips
    // it from the DOM when serializing real typed content.
    pushBlock({
      type: "paragraph",
      text: paragraph.join("\n").trim()
    });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const codeFence = trimmed.match(/^(`{3,})(\w+)?/);
    if (codeFence) {
      flushParagraph();
      const fenceLength = codeFence[1].length;
      const language = codeFence[2] ?? "";
      const codeLines: string[] = [];
      index += 1;
      // Close only on a line of at least as many backticks as the opener, so code
      // that itself contains a ``` line (fenced with 4+ backticks) round-trips.
      const isClosingFence = (line: string) => {
        const fence = line.trim();
        return /^`+$/.test(fence) && fence.length >= fenceLength;
      };
      while (index < lines.length && !isClosingFence(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      pushBlock({
        type: "code",
        text: codeLines.join("\n"),
        language
      });
      continue;
    }

    if (isTableStart(lines, index)) {
      flushParagraph();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim() && isTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      pushBlock({
        type: "table",
        text: tableLines.join("\n")
      });
      continue;
    }

    if (parseMarkdownImage(trimmed)) {
      flushParagraph();
      pushBlock({
        type: "image",
        text: trimmed
      });
      continue;
    }

    // A line of 3+ matching -, * or _ is a horizontal rule. It sits after the
    // table check (a table separator only parses with a preceding header row) and
    // before the list checks (their markers need a trailing space, so "---" etc.
    // never reach them anyway).
    if (isThematicBreak(trimmed)) {
      flushParagraph();
      pushBlock({ type: "thematic-break", text: "" });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      pushBlock({
        type: "heading",
        level: heading[1].length,
        text: heading[2]
      });
      continue;
    }

    // Allow empty list items (`1.`, `-`) so a freshly-created item survives a
    // round-trip while the writer is about to type into it.
    const ordered = trimmed.match(/^(\d+)\.(?:\s+(.*))?$/);
    if (ordered) {
      flushParagraph();
      pushBlock({
        type: "ordered-list",
        marker: ordered[1],
        text: ordered[2] ?? ""
      });
      continue;
    }

    const unordered = trimmed.match(/^[-*](?:\s+(.*))?$/);
    if (unordered) {
      flushParagraph();
      const itemText = unordered[1] ?? "";
      // A `[ ]` / `[x]` prefix (a space or letter needs to follow, per GFM) makes
      // this a task-list item: strip the box from the text and record its state.
      const task = itemText.match(/^\[([ xX])\](?:\s+(.*))?$/);
      pushBlock({
        type: "unordered-list",
        text: task ? task[2] ?? "" : itemText,
        checked: task ? task[1].toLowerCase() === "x" : undefined
      });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      pushBlock({
        type: "quote",
        text: quote[1]
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function listItemLines(text: string) {
  const lines = text.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  return lines.length > 0 ? lines : [""];
}

function isListBlockType(type: MarkdownBlockType) {
  return type === "ordered-list" || type === "unordered-list";
}

function serializeMarkdownBlock(block: MarkdownBlock) {
  const text = block.text.trimEnd();
  if (block.type === "heading") return `${"#".repeat(block.level ?? 2)} ${text}`;
  // A list block can hold several lines once the user presses Enter inside it
  // (each line break becomes a new sibling item). Emit one marker per line so it
  // re-parses as a list, not a list followed by a paragraph.
  if (block.type === "ordered-list") {
    return listItemLines(text).map((line) => `${block.marker ?? "1"}. ${line}`).join("\n");
  }
  if (block.type === "unordered-list") {
    const box = block.checked === undefined ? "" : block.checked ? "[x] " : "[ ] ";
    return listItemLines(text).map((line) => `- ${box}${line}`).join("\n");
  }
  if (block.type === "quote") return text.split("\n").map((line) => `> ${line}`).join("\n");
  if (block.type === "thematic-break") return "---";
  if (block.type === "code") {
    // Use a fence longer than any backtick run in the code so content containing
    // ``` doesn't terminate the block early.
    const longestRun = (block.text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `${fence}${block.language ?? ""}\n${block.text}\n${fence}`;
  }
  return text;
}

export function serializeMarkdownBlocks(blocks: MarkdownBlock[]) {
  let output = "";
  blocks.forEach((block, index) => {
    if (index > 0) {
      // Keep consecutive list items of the SAME kind tight (single newline) so a
      // run reads as one list; switching ordered<->unordered (or any non-list
      // boundary) gets a blank line so the two lists don't merge into one.
      const previous = blocks[index - 1];
      output += isListBlockType(block.type) && block.type === previous.type ? "\n" : "\n\n";
    }
    output += serializeMarkdownBlock(block);
  });
  return output.trimEnd().concat("\n");
}

function clampMarkdownIndex(index: number, min: number, max: number) {
  return Math.min(Math.max(index, min), max);
}

export function looksLikeMarkdownPaste(value: string) {
  const text = value.trim();
  if (!text) return false;

  return (
    /^#{1,6}\s+\S/m.test(text) ||
    /^```/m.test(text) ||
    /^!\[[^\]\n]*\]\([^)]+\)$/m.test(text) ||
    /^\s*(?:[-*+]\s+|\d+\.\s+)/m.test(text) ||
    /^\s*>\s+\S/m.test(text) ||
    /\|.+\|\s*\n\s*\|?\s*:?-{3,}:?\s*(?:\||$)/m.test(text) ||
    /\[[^\]\n]+\]\([^)]+\)/.test(text) ||
    /<(?:https?|mailto):[^>\s]+>/.test(text) ||
    /(?:\*\*|__)[^*_]+(?:\*\*|__)/.test(text) ||
    /`[^`\n]+`/.test(text) ||
    /\n\s*\n/.test(text)
  );
}

export function normalizeMarkdownPaste(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const blocks = parseMarkdownBlocks(normalized);
  return blocks.length > 0 ? serializeMarkdownBlocks(blocks).trimEnd() : normalized;
}

export function shouldPasteAsMarkdownBlocks(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return false;

  const blocks = parseMarkdownBlocks(normalized);
  return blocks.length > 1 || blocks.some((block) => block.type !== "paragraph") || /\n\s*\n/.test(normalized);
}

export function spliceMarkdownPaste(markdown: string, start: number, end: number, insertion: string, blockMode: boolean) {
  const safeStart = clampMarkdownIndex(Math.min(start, end), 0, markdown.length);
  const safeEnd = clampMarkdownIndex(Math.max(start, end), safeStart, markdown.length);
  const text = blockMode ? normalizeMarkdownPaste(insertion) : insertion.replace(/\r\n/g, "\n");
  if (!text) return markdown;

  if (!blockMode) {
    return `${markdown.slice(0, safeStart)}${text}${markdown.slice(safeEnd)}`;
  }

  const before = markdown.slice(0, safeStart).trimEnd();
  const after = markdown.slice(safeEnd).trimStart();
  return [before, text.trim(), after].filter(Boolean).join("\n\n").trimEnd().concat("\n");
}

export function updateMarkdownBlock(markdown: string, blockId: string, text: string) {
  const blocks = parseMarkdownBlocks(markdown);
  if (blocks.length === 0 && blockId === markdownBlockIdFromIndex(0)) {
    return serializeMarkdownBlocks(text.trim() ? [{ id: blockId, type: "paragraph", text }] : []);
  }

  return serializeMarkdownBlocks(
    blocks.flatMap((block) => {
      if (block.id !== blockId) return [block];
      const nextText = text.trim();
      return nextText ? [{ ...block, text }] : [];
    })
  );
}

export function updateMarkdownBlockShape(
  markdown: string,
  blockId: string,
  patch: Partial<Pick<MarkdownBlock, "type" | "level" | "marker" | "language" | "checked">>
) {
  const blocks = parseMarkdownBlocks(markdown);
  return serializeMarkdownBlocks(
    blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block))
  );
}

export function deleteMarkdownBlock(markdown: string, blockId: string) {
  return serializeMarkdownBlocks(parseMarkdownBlocks(markdown).filter((block) => block.id !== blockId));
}

export function moveMarkdownBlock(
  markdown: string,
  blockId: string,
  targetBlockId: string,
  placement: "before" | "after"
) {
  if (blockId === targetBlockId) return markdown;

  const blocks = parseMarkdownBlocks(markdown);
  const sourceIndex = blocks.findIndex((block) => block.id === blockId);
  const targetIndex = blocks.findIndex((block) => block.id === targetBlockId);
  if (sourceIndex === -1 || targetIndex === -1) return markdown;

  const [sourceBlock] = blocks.splice(sourceIndex, 1);
  const adjustedTargetIndex = blocks.findIndex((block) => block.id === targetBlockId);
  if (adjustedTargetIndex === -1) return markdown;

  const insertionIndex = placement === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  blocks.splice(insertionIndex, 0, sourceBlock);
  return serializeMarkdownBlocks(blocks);
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

// Pad every row to a common width (minimum two columns). Cell values are left as
// they are — escaping happens once, at serialize time (serializeMarkdownTable), so
// values pass through here unchanged whether they came from a parse or an edit.
function normalizeTableRows(rows: string[][]) {
  const width = Math.max(2, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

export function parseMarkdownTable(markdown: string) {
  const lines: string[] = [];
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line) lines.push(line);
  }
  if (lines.length < 2 || !isTableRow(lines[0]) || !isTableSeparator(lines[1])) return null;

  const parsedRows = [splitTableRow(lines[0])];
  for (const line of lines.slice(2)) {
    if (isTableRow(line)) parsedRows.push(splitTableRow(line));
  }
  const rows = normalizeTableRows(parsedRows);
  if (rows.length === 0) return null;

  const alignments = splitTableRow(lines[1]).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    if (trimmed.startsWith(":")) return "left";
    return "";
  });

  return {
    headers: rows[0],
    rows: rows.slice(1),
    alignments
  };
}

// Structure edits on a table's Markdown text. Each parses, transforms the
// headers/body, and re-serializes; an unparseable string (or an edit that would
// break the 2-column / header-row minimums Markdown tables require) is returned
// unchanged. Column alignment is not preserved — serializeMarkdownTable already
// drops it on every edit, so these match that existing behaviour.
export function withTableColumnAdded(markdown: string) {
  const table = parseMarkdownTable(markdown);
  if (!table) return markdown;
  return serializeMarkdownTable([...table.headers, ""], table.rows.map((row) => [...row, ""]));
}

export function withTableColumnRemoved(markdown: string, columnIndex: number) {
  const table = parseMarkdownTable(markdown);
  // A Markdown table needs at least two columns, so refuse to drop below that.
  if (!table || table.headers.length <= 2) return markdown;
  const dropColumn = (row: string[]) => row.filter((_, index) => index !== columnIndex);
  return serializeMarkdownTable(dropColumn(table.headers), table.rows.map(dropColumn));
}

export function withTableRowAdded(markdown: string) {
  const table = parseMarkdownTable(markdown);
  if (!table) return markdown;
  const emptyRow = Array.from({ length: table.headers.length }, () => "");
  return serializeMarkdownTable(table.headers, [...table.rows, emptyRow]);
}

export function withTableRowRemoved(markdown: string, rowIndex: number) {
  const table = parseMarkdownTable(markdown);
  // rowIndex is the body-row index; the header row is structural and can't go. Keep
  // at least one body row: a header-only table renders a synthetic placeholder row
  // that the live-save would serialize back, silently undoing the delete.
  if (!table || table.rows.length <= 1) return markdown;
  return serializeMarkdownTable(table.headers, table.rows.filter((_, index) => index !== rowIndex));
}

export function serializeMarkdownTable(headers: string[], rows: string[][]) {
  const normalizedRows = normalizeTableRows([headers, ...rows]);
  const width = normalizedRows[0]?.length ?? 2;
  const header = normalizedRows[0] ?? Array.from({ length: width }, () => "");
  const bodyRows = normalizedRows.slice(1);
  const separator = Array.from({ length: width }, () => "---");
  const serializeRow = (row: string[]) => `| ${row.map(escapeTableCell).join(" | ")} |`;

  return [serializeRow(header), serializeRow(separator), ...bodyRows.map(serializeRow)].join("\n");
}

export function htmlToInlineMarkdown(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const tableToMarkdown = (table: HTMLTableElement) => {
    const headerCells = Array.from(table.querySelectorAll("thead tr:first-child th, thead tr:first-child td"));
    const fallbackHeaderCells = Array.from(table.querySelectorAll("tr:first-child th, tr:first-child td"));
    const headers = (headerCells.length > 0 ? headerCells : fallbackHeaderCells).map((cell) =>
      Array.from(cell.childNodes).map(walk).join("").trim()
    );
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const fallbackRows = Array.from(table.querySelectorAll("tr")).slice(headerCells.length > 0 ? 0 : 1);
    const rows = (bodyRows.length > 0 ? bodyRows : fallbackRows).map((row) =>
      Array.from(row.querySelectorAll("th, td")).map((cell) => Array.from(cell.childNodes).map(walk).join("").trim())
    );

    return serializeMarkdownTable(headers, rows);
  };

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "");
    if (!(node instanceof HTMLElement)) return "";

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "img") {
      // Prefer the original markdown src stashed on inline images; fall back to the
      // live src for pasted/foreign <img> elements — including when data-md-src is
      // present but blank.
      const markdownSrc = node.getAttribute("data-md-src")?.trim();
      const src = markdownSrc || node.getAttribute("src")?.trim();
      if (!src) return "";
      return serializeMarkdownImage({ alt: node.getAttribute("alt") ?? "", src });
    }
    if (tag === "table") return tableToMarkdown(node as HTMLTableElement);

    const body = Array.from(node.childNodes).map(walk).join("");
    if (node.classList.contains("anchor-highlight")) return body;
    if (tag === "a") {
      const href = node.getAttribute("href")?.trim();
      if (!href || !body) return body;
      return `[${body.replace(/\]/g, "\\]")}](${href.replace(/\)/g, "%29")})`;
    }
    if (tag === "strong" || tag === "b") return body ? `**${body}**` : "";
    if (tag === "em" || tag === "i") return body ? `*${body}*` : "";
    if (tag === "code") return body ? `\`${body.replace(/`/g, "'")}\`` : "";
    if (tag === "s" || tag === "del" || tag === "strike") return body ? `~~${body}~~` : "";
    if (tag === "div" || tag === "p") return body ? `${body}\n` : "";
    return body;
  };

  return Array.from(container.childNodes)
    .map(walk)
    .join("")
    .replace(/\u200B/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
