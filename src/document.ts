import type { ReviewThread, SelectionDraft } from "./types";

export type MarkdownBlockType = "heading" | "paragraph" | "ordered-list" | "unordered-list" | "quote" | "code";

export interface MarkdownBlock {
  id: string;
  type: MarkdownBlockType;
  text: string;
  level?: number;
  marker?: string;
  language?: string;
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
  const index = markdown.indexOf(original);
  if (index === -1) {
    const whitespaceFlexible = original.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const match = markdown.match(new RegExp(whitespaceFlexible));
    if (!match || match.index === undefined) return markdown;
    return `${markdown.slice(0, match.index)}${replacement}${markdown.slice(match.index + match[0].length)}`;
  }
  return `${markdown.slice(0, index)}${replacement}${markdown.slice(index + original.length)}`;
}

export function extractOutline(markdown: string) {
  return markdown
    .split("\n")
    .map((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (!match) return null;
      return {
        id: `line-${index + 1}`,
        level: match[1].length,
        title: match[2].trim(),
        line: index + 1
      };
    })
    .filter(Boolean) as Array<{ id: string; level: number; title: string; line: number }>;
}

export function openThreads(threads: ReviewThread[]) {
  return threads.filter((thread) => thread.status === "open");
}

export function wordCount(markdown: string) {
  return markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let blockIndex = 0;

  const nextId = () => `block-${blockIndex++}`;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({
      id: nextId(),
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

    const codeFence = trimmed.match(/^```(\w+)?/);
    if (codeFence) {
      flushParagraph();
      const language = codeFence[1] ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({
        id: nextId(),
        type: "code",
        text: codeLines.join("\n"),
        language
      });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        id: nextId(),
        type: "heading",
        level: heading[1].length,
        text: heading[2]
      });
      continue;
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({
        id: nextId(),
        type: "ordered-list",
        marker: ordered[1],
        text: ordered[2]
      });
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      blocks.push({
        id: nextId(),
        type: "unordered-list",
        text: unordered[1]
      });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      blocks.push({
        id: nextId(),
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

export function serializeMarkdownBlocks(blocks: MarkdownBlock[]) {
  return blocks
    .map((block) => {
      const text = block.text.trimEnd();
      if (block.type === "heading") return `${"#".repeat(block.level ?? 2)} ${text}`;
      if (block.type === "ordered-list") return `${block.marker ?? "1"}. ${text}`;
      if (block.type === "unordered-list") return `- ${text}`;
      if (block.type === "quote") return text.split("\n").map((line) => `> ${line}`).join("\n");
      if (block.type === "code") return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
      return text;
    })
    .join("\n\n")
    .trimEnd()
    .concat("\n");
}

export function updateMarkdownBlock(markdown: string, blockId: string, text: string) {
  const blocks = parseMarkdownBlocks(markdown);
  return serializeMarkdownBlocks(
    blocks.map((block) => (block.id === blockId ? { ...block, text } : block))
  );
}

export function updateMarkdownBlockShape(
  markdown: string,
  blockId: string,
  patch: Partial<Pick<MarkdownBlock, "type" | "level" | "marker">>
) {
  const blocks = parseMarkdownBlocks(markdown);
  return serializeMarkdownBlocks(
    blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block))
  );
}

export function inlineMarkdownToHtml(markdown: string) {
  let html = escapeHtml(markdown);

  const codeSegments: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const index = codeSegments.push(`<code>${code}</code>`) - 1;
    return `\u0000CODE${index}\u0000`;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\n/g, "<br />");

  codeSegments.forEach((segment, index) => {
    html = html.replace(`\u0000CODE${index}\u0000`, segment);
  });

  return html;
}

export function htmlToInlineMarkdown(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";

    const body = Array.from(node.childNodes).map(walk).join("");
    if (node.classList.contains("anchor-highlight")) return body;
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
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
