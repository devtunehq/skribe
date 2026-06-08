import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiFileDiff } from "@pierre/diffs/react";
import {
  BookOpen,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Copy,
  Download,
  FileText,
  Globe,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  History,
  Image as ImageIcon,
  Italic,
  Eye,
  EyeOff,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquare,
  PenLine,
  Pilcrow,
  Quote,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Send,
  Settings,
  Sparkles,
  Upload,
  X
} from "lucide-react";
import {
  fetchAppSettings,
  fetchAgentSkills,
  fetchAgentRuntimes,
  fetchDocument,
  fetchRevisionHistory,
  generateToneOfVoice,
  restoreDocumentRevision,
  saveDocument,
  sendAgentMessage,
  sendToneInterviewMessage,
  subscribeToDocumentEvents,
  updateAgentConfig,
  updateAppSettings,
  uploadImageAsset
} from "./api";
import {
  applySuggestion,
  buildSelection,
  deleteMarkdownBlock,
  extractOutline,
  makeId,
  nowIso,
  openThreads,
  titleFromMarkdown,
  wordCount,
  htmlToInlineMarkdown,
  looksLikeMarkdownPaste,
  markdownBlockIdFromIndex,
  normalizeMarkdownPaste,
  parseMarkdownTable,
  parseMarkdownImage,
  parseMarkdownBlocks,
  moveMarkdownBlock,
  serializeMarkdownBlocks,
  shouldPasteAsMarkdownBlocks,
  spliceMarkdownPaste,
  updateMarkdownBlock,
  updateMarkdownBlockShape
} from "./document";
import {
  applyProposalDecisionTransitions,
  buildInlineProposalReview,
  buildProposalDiff,
  getProposalChangeBlocks,
  lineRangeLabel,
  resolveProposalStatus,
  trimBlockText
} from "./proposals";
import type { InlineProposalChange, InlineProposalReview, ProposalChangeBlock } from "./proposals";
import {
  clamp,
  getMarkdownBlockLineSpans,
  markdownOffsetFromPlainOffset,
  markdownRangeFromPlainRange,
  renderedMarkdownSnippet,
  visibleMarkdownCharacters
} from "./markdownRanges";
import {
  applyThreadSuggestionToMarkdown,
  findThreadAnchorInText,
  getThreadAnchorCandidates
} from "./threadSuggestions";
import {
  buildSelectionFromMarkdownRange,
  deleteSelectionDraftFromMarkdown,
  resolveSelectionDraftRange
} from "./selection";
import type {
  AgentSession,
  AgentRuntimeConfig,
  AgentSkill,
  AgentSkillSelection,
  AppSettings,
  Author,
  ChatMessage,
  ContextLedgerEvent,
  ContextLedgerEventType,
  DiffViewMode,
  DocumentProposal,
  DocumentState,
  DocumentFont,
  EditorLanguage,
  FileInfo,
  AppTheme,
  RevisionState,
  ProposalChangeDecision,
  ReviewThread,
  SelectionDraft,
  ToneInterviewMessage,
  ToneSetupMode
} from "./types";

type PanelMode = "threads" | "chat";
type SaveState = "loading" | "saved" | "saving" | "error";
type SupportedEditorLanguage = EditorLanguage;
type SupportedDocumentFont = DocumentFont;
type SupportedAppTheme = AppTheme;
type SupportedDiffViewMode = DiffViewMode;
type ToneSetupInvocation = "first-run" | "settings";
type SettingsTab = "writing" | "agent" | "workspace";
type BlockDropPlacement = "before" | "after";
type FloatingToolbarState = {
  left: number;
  top: number;
  placement: "above" | "below";
};
type LinkPopoverState = {
  left: number;
  top: number;
};
type SelectionContextMenuState = {
  left: number;
  top: number;
  hasSelection: boolean;
};
type LinkTargetState = {
  blockId: string;
  selectedText: string;
  plainStart: number;
  plainEnd: number;
  markdownAtOpen: string;
};
type ClipboardPayload = {
  plainText: string;
  markdown?: string;
};
type SelectionEndpoint = {
  blockId: string;
  sourceIndex: number;
};
type SelectionDragState = {
  x: number;
  y: number;
  pointerId: number;
  endpoint: SelectionEndpoint;
  draft: SelectionDraft | null;
  isSelecting: boolean;
};
type HistorySnapshot = Pick<DocumentState, "markdown" | "review">;

const authorLabels: Record<Author, string> = {
  human: "Human",
  agent: "Agent"
};

const editorLanguageOptions: Array<{ value: SupportedEditorLanguage; label: string }> = [
  { value: "en-GB", label: "EN-GB" },
  { value: "en-US", label: "EN-US" }
];

const documentFontOptions: Array<{ value: SupportedDocumentFont; label: string; description: string }> = [
  { value: "default", label: "Skribe default", description: "Mono headings, clean sans body." },
  { value: "sans", label: "Clean sans", description: "Sans throughout the document." },
  { value: "serif", label: "Editorial serif", description: "Warmer long-form reading." },
  { value: "mono", label: "Mono draft", description: "Technical, precise drafting." }
];

const appThemeOptions: Array<{ value: SupportedAppTheme; label: string; description: string }> = [
  { value: "default", label: "Skribe", description: "Oat paper, yellow mark, blue actions." },
  { value: "newsprint", label: "Newsprint", description: "Quiet editorial monochrome with red notes." },
  { value: "sage", label: "Sage", description: "Soft green workspace with mint actions." },
  { value: "coral", label: "Coral", description: "Warm paper, coral accents, blue links." },
  { value: "graphite", label: "Graphite", description: "Dark desk, bright controls." }
];

const diffViewModeOptions: Array<{ value: SupportedDiffViewMode; label: string; description: string }> = [
  { value: "split", label: "Split", description: "Show current and proposed text side by side." },
  { value: "unified", label: "Unified", description: "Show removals and additions in one compact flow." }
];

const settingsTabOptions: Array<{ id: SettingsTab; label: string }> = [
  { id: "writing", label: "Writing" },
  { id: "agent", label: "Agent" },
  { id: "workspace", label: "Workspace" }
];

const toneSetupModes: Array<{ id: ToneSetupMode; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "interview", label: "Interview" },
  { id: "links", label: "Links" },
  { id: "archetype", label: "Archetypes" }
];

const toneArchetypeOptions = [
  {
    id: "direct-founder",
    label: "Direct founder",
    description: "Plainspoken, concrete, low-hype."
  },
  {
    id: "technical-editorial",
    label: "Technical editorial",
    description: "Analytical, clear, market-aware."
  },
  {
    id: "operator-memo",
    label: "Operator memo",
    description: "Practical, concise, tradeoff-led."
  },
  {
    id: "warm-teacher",
    label: "Warm teacher",
    description: "Patient, accessible, concrete."
  },
  {
    id: "sharp-critic",
    label: "Sharp critic",
    description: "Pointed, fair, unsentimental."
  },
  {
    id: "narrative-builder",
    label: "Narrative builder",
    description: "Thoughtful, thesis-led, grounded."
  }
];

const defaultAppSettings: AppSettings = {
  version: 1,
  toneOfVoice: "",
  toneOfVoiceSetupComplete: false,
  editorLanguage: "en-GB",
  documentFont: "default",
  theme: "default",
  agentRuntime: "auto",
  agentModel: "auto",
  agentEffort: "auto",
  defaultSkills: [],
  autoReplyToComments: true,
  showResolvedThreads: false,
  panelState: {
    leftCollapsed: false,
    rightCollapsed: false
  },
  proposalModeDefault: "conservative",
  diffViewMode: "split"
};

const emptyThreads: ReviewThread[] = [];
const emptyProposals: DocumentProposal[] = [];

function mergeAppSettings(settings?: Partial<AppSettings> | null): AppSettings {
  const requestedDocumentFont = settings?.documentFont;
  const requestedTheme = settings?.theme;
  const requestedDiffViewMode = settings?.diffViewMode;
  const documentFont: SupportedDocumentFont = documentFontOptions.some((option) => option.value === requestedDocumentFont)
    ? (requestedDocumentFont as SupportedDocumentFont)
    : defaultAppSettings.documentFont;
  const theme: SupportedAppTheme = appThemeOptions.some((option) => option.value === requestedTheme)
    ? (requestedTheme as SupportedAppTheme)
    : defaultAppSettings.theme;
  const diffViewMode: SupportedDiffViewMode = diffViewModeOptions.some((option) => option.value === requestedDiffViewMode)
    ? (requestedDiffViewMode as SupportedDiffViewMode)
    : defaultAppSettings.diffViewMode;
  return {
    ...defaultAppSettings,
    ...(settings ?? {}),
    documentFont,
    theme,
    diffViewMode,
    defaultSkills: Array.isArray(settings?.defaultSkills) ? settings.defaultSkills : defaultAppSettings.defaultSkills,
    panelState: {
      ...defaultAppSettings.panelState,
      ...(settings?.panelState ?? {})
    }
  };
}

function fileNameFromPath(path?: string) {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) || "Untitled";
}

function documentSourceLabel(fileInfo?: FileInfo) {
  if (!fileInfo) return "Local Markdown review workbench";
  if (fileInfo.source === "external") return fileNameFromPath(fileInfo.displayPath || fileInfo.markdownPath);
  return "Internal draft";
}

function safeDownloadName(value: string) {
  return value.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "skribe";
}

function modelIsAdvertisedByDifferentRuntime(
  model: string,
  runtimeId: string | null | undefined,
  runtimes: AgentRuntimeConfig["runtimes"]
) {
  if (!model || model === "auto" || !runtimeId) return false;

  const runtimesAdvertisingModel = runtimes.filter((runtime) => runtime.models.some((option) => option.id === model));
  if (runtimesAdvertisingModel.length === 0) return false;

  return !runtimesAdvertisingModel.some((runtime) => runtime.id === runtimeId);
}

const maxContextLedgerEvents = 240;

interface BlockAnchorRange {
  thread: ReviewThread;
  start: number;
  end: number;
}

function numericCssValue(value: string, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function computedFont(style: CSSStyleDeclaration) {
  return [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontSize,
    style.fontFamily
  ].join(" ");
}

function isVisibleColor(value: string) {
  return value !== "transparent" && value !== "rgba(0, 0, 0, 0)";
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const paragraphs = text.split(/\n/);
  const lines: string[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (paragraphIndex < paragraphs.length - 1) lines.push("");
      return;
    }

    let line = "";
    words.forEach((word) => {
      const nextLine = line ? `${line} ${word}` : word;
      if (line && context.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = word;
        return;
      }
      line = nextLine;
    });
    lines.push(line);
  });

  return lines.length > 0 ? lines : [""];
}

async function downloadTableAsPng(table: HTMLTableElement, filename: string) {
  const rect = table.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  if (width <= 0 || height <= 0) throw new Error("Cannot export an empty table.");

  const padding = 24;
  const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((width + padding * 2) * scale);
  canvas.height = Math.ceil((height + padding * 2) * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable.");

  context.scale(scale, scale);

  const tableStyle = window.getComputedStyle(table);
  const tableX = padding;
  const tableY = padding;
  if (tableStyle.boxShadow !== "none") {
    context.fillStyle = "rgba(56, 56, 56, 0.72)";
    context.fillRect(tableX - 3, tableY + 3, width, height);
  }
  if (isVisibleColor(tableStyle.backgroundColor)) {
    context.fillStyle = tableStyle.backgroundColor;
    context.fillRect(tableX, tableY, width, height);
  }

  Array.from(table.rows).forEach((row) => {
    Array.from(row.cells).forEach((cell) => {
      const cellRect = cell.getBoundingClientRect();
      const style = window.getComputedStyle(cell);
      const x = tableX + cellRect.left - rect.left;
      const y = tableY + cellRect.top - rect.top;
      const cellWidth = cellRect.width;
      const cellHeight = cellRect.height;

      if (isVisibleColor(style.backgroundColor)) {
        context.fillStyle = style.backgroundColor;
        context.fillRect(x, y, cellWidth, cellHeight);
      }

      context.strokeStyle = style.borderTopColor || tableStyle.borderTopColor || "#383838";
      context.lineWidth = Math.max(1, numericCssValue(style.borderTopWidth, 1));
      context.strokeRect(x + 0.5, y + 0.5, Math.max(0, cellWidth - 1), Math.max(0, cellHeight - 1));

      const paddingLeft = numericCssValue(style.paddingLeft, 10);
      const paddingRight = numericCssValue(style.paddingRight, 10);
      const paddingTop = numericCssValue(style.paddingTop, 8);
      const paddingBottom = numericCssValue(style.paddingBottom, 8);
      const lineHeight = numericCssValue(style.lineHeight, numericCssValue(style.fontSize, 16) * 1.35);
      const textWidth = Math.max(1, cellWidth - paddingLeft - paddingRight);
      context.font = computedFont(style);
      const lines = wrapCanvasText(context, cell.innerText.replace(/\u200B/g, "").trim(), textWidth);
      const textAlign = style.textAlign;

      context.fillStyle = style.color || "#383838";
      context.textBaseline = "top";

      lines.forEach((line, index) => {
        const textY = y + paddingTop + index * lineHeight;
        if (textY + lineHeight > y + cellHeight - paddingBottom + 1) return;
        const measuredWidth = context.measureText(line).width;
        const textX =
          textAlign === "right"
            ? x + cellWidth - paddingRight - measuredWidth
            : textAlign === "center"
              ? x + paddingLeft + (textWidth - measuredWidth) / 2
              : x + paddingLeft;
        context.fillText(line, textX, textY);
      });
    });
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((output) => {
      if (output) resolve(output);
      else reject(new Error("Unable to create table image."));
    }, "image/png");
  });

  const pngUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = `${safeDownloadName(filename)}.png`;
  link.click();
  URL.revokeObjectURL(pngUrl);
}

function clipText(text: string, maxLength = 260) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function imagePreviewSrc(src: string) {
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  return `/api/assets?src=${encodeURIComponent(src)}`;
}

function imageDisplayName(src: string) {
  const clean = src.split(/[?#]/)[0] || src;
  return decodeURIComponent(clean.split("/").filter(Boolean).at(-1) || "image");
}

function createLedgerEvent({
  type,
  actor,
  summary,
  createdAt,
  threadId,
  proposalId,
  changeKey,
  metadata
}: {
  type: ContextLedgerEventType;
  actor: Author;
  summary: string;
  createdAt: string;
  threadId?: string | null;
  proposalId?: string | null;
  changeKey?: string | null;
  metadata?: ContextLedgerEvent["metadata"];
}): ContextLedgerEvent {
  return {
    id: makeId("mem"),
    type,
    actor,
    summary: clipText(summary, 360),
    createdAt,
    threadId,
    proposalId,
    changeKey,
    metadata
  };
}

function appendLedgerEvents(
  events: ContextLedgerEvent[] | undefined,
  nextEvents: Array<ContextLedgerEvent | null | undefined>
) {
  const merged = [...(events ?? []), ...(nextEvents.filter(Boolean) as ContextLedgerEvent[])];
  return merged.slice(-maxContextLedgerEvents);
}

function normalizeLinkHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeMarkdownLinkHref(value: string) {
  return value.replace(/\s+/g, "%20").replace(/\)/g, "%29");
}

function closestEditableBlock(node: Node) {
  const element = node instanceof Element ? node : node.parentNode instanceof Element ? node.parentNode : null;
  return element?.closest<HTMLElement>("[data-block-id]") ?? null;
}

function plainOffsetInEditableBlock(blockNode: HTMLElement, container: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(blockNode);
  range.setEnd(container, offset);
  return range.toString().length;
}

function buildSelectionFromCanvasRange(markdown: string, range: Range): SelectionDraft | null {
  const startBlockNode = closestEditableBlock(range.startContainer);
  const endBlockNode = closestEditableBlock(range.endContainer);
  const startBlockId = startBlockNode?.dataset.blockId;
  const endBlockId = endBlockNode?.dataset.blockId;
  if (!startBlockNode || !endBlockNode || !startBlockId || !endBlockId) return null;

  const spans = getMarkdownBlockLineSpans(markdown);
  const startSpan = spans.find((span) => span.id === startBlockId);
  const endSpan = spans.find((span) => span.id === endBlockId);
  const blocks = parseMarkdownBlocks(markdown);
  const startBlock = blocks.find((block) => block.id === startBlockId);
  const endBlock = blocks.find((block) => block.id === endBlockId);
  if (!startSpan || !endSpan || !startBlock || !endBlock) return null;

  const startPlainOffset = plainOffsetInEditableBlock(startBlockNode, range.startContainer, range.startOffset);
  const endPlainOffset = plainOffsetInEditableBlock(endBlockNode, range.endContainer, range.endOffset);
  const start = startSpan.textStart + markdownOffsetFromPlainOffset(startBlock.text, startPlainOffset, "start");
  const end = endSpan.textStart + markdownOffsetFromPlainOffset(endBlock.text, endPlainOffset, "end");
  if (end <= start) return null;

  const exact = range.toString().replace(/\s+/g, " ").trim();
  if (!exact) return null;

  return {
    kind: "markdown-range",
    exact,
    prefix: markdown.slice(Math.max(0, start - 120), start).replace(/\s+/g, " ").trim(),
    suffix: markdown.slice(end, end + 120).replace(/\s+/g, " ").trim(),
    start,
    end
  };
}

function markdownToClipboardText(markdown: string) {
  return markdown
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/[*_`~]/g, "")
        .trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const inlineMarkdownPattern =
  /`([^`]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|\n/g;

function safeRenderedMarkdownHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed || /[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;
  if (/^(?:https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null;
  return trimmed;
}

function inlineMarkdownNodes(markdown: string, keyPrefix = "inline") {
  if (!markdown) return null;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of markdown.matchAll(inlineMarkdownPattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(markdown.slice(cursor, start));

    const [raw, code, linkLabel, linkHref, boldAsterisk, boldUnderscore, strike, italicAsterisk, italicUnderscore] = match;
    const nodeKey = `${keyPrefix}-${key++}`;

    if (code !== undefined) {
      nodes.push(<code key={nodeKey}>{code}</code>);
    } else if (linkLabel !== undefined && linkHref !== undefined) {
      const safeHref = safeRenderedMarkdownHref(linkHref);
      nodes.push(
        safeHref ? (
          <a key={nodeKey} href={safeHref} target="_blank" rel="noreferrer">
            {linkLabel}
          </a>
        ) : (
          raw
        )
      );
    } else if (boldAsterisk !== undefined || boldUnderscore !== undefined) {
      nodes.push(<strong key={nodeKey}>{boldAsterisk ?? boldUnderscore}</strong>);
    } else if (strike !== undefined) {
      nodes.push(<s key={nodeKey}>{strike}</s>);
    } else if (italicAsterisk !== undefined || italicUnderscore !== undefined) {
      nodes.push(<em key={nodeKey}>{italicAsterisk ?? italicUnderscore}</em>);
    } else {
      nodes.push(<br key={nodeKey} />);
    }

    cursor = start + raw.length;
  }

  if (cursor < markdown.length) nodes.push(markdown.slice(cursor));
  return nodes;
}

function InlineMarkdown({ markdown, keyPrefix }: { markdown: string; keyPrefix?: string }) {
  return <>{inlineMarkdownNodes(markdown, keyPrefix)}</>;
}

function caretRangeFromPoint(x: number, y: number) {
  const caretDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = caretDocument.caretRangeFromPoint?.(x, y);
  if (range) return range;

  const position = caretDocument.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const nextRange = document.createRange();
  nextRange.setStart(position.offsetNode, position.offset);
  nextRange.collapse(true);
  return nextRange;
}

function applyMarkdownLinkToSelection(markdown: string, target: LinkTargetState, href: string) {
  const range =
    markdown === target.markdownAtOpen
      ? markdownRangeFromPlainRange(markdown, target.plainStart, target.plainEnd)
      : (() => {
          const index = markdown.indexOf(target.selectedText);
          return index >= 0 ? { start: index, end: index + target.selectedText.length } : null;
        })();
  if (!range) return null;

  const label = escapeMarkdownLinkLabel(target.selectedText.replace(/\s+/g, " ").trim());
  if (!label) return null;

  return `${markdown.slice(0, range.start)}[${label}](${escapeMarkdownLinkHref(href)})${markdown.slice(range.end)}`;
}

function getNextInlineChangeKey(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const currentCard = target.closest<HTMLElement>("[data-inline-proposal-change]");
  if (!currentCard) return null;

  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-inline-proposal-change]"));
  const currentIndex = cards.indexOf(currentCard);
  return currentIndex >= 0 ? cards[currentIndex + 1]?.dataset.changeKey ?? null : null;
}

function scrollToInlineChange(changeKey: string | null) {
  if (!changeKey) return;

  window.setTimeout(() => {
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-inline-proposal-change]")).find(
      (card) => card.dataset.changeKey === changeKey
    );
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, 80);
}

function skillCommandId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function skillLabel(skill: AgentSkill | AgentSkillSelection) {
  return skill.name || skill.id;
}

function findSkillByCommand(skills: AgentSkill[], command: string) {
  const normalized = skillCommandId(command);
  return skills.find((skill) => skill.id === normalized || skillCommandId(skill.name) === normalized) ?? null;
}

function uniqueSkillIds(ids: string[]) {
  return Array.from(new Set(ids.map(skillCommandId).filter(Boolean))).slice(0, 8);
}

function getActiveSlashCommand(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)\/([a-zA-Z0-9:_-]*)$/);
  if (!match) return null;
  const start = cursor - match[0].length + match[1].length;
  return {
    start,
    end: cursor,
    query: match[2] ?? ""
  };
}

function skillMatchesQuery(skill: AgentSkill, query: string) {
  const normalized = query.toLowerCase();
  return (
    skill.id.includes(normalized) ||
    skill.name.toLowerCase().includes(normalized) ||
    skill.description.toLowerCase().includes(normalized)
  );
}

function extractSkillIdsFromDraft(value: string, skills: AgentSkill[]) {
  const ids: string[] = [];
  for (const match of value.matchAll(/(^|\s)\/([a-zA-Z0-9:_-]+)/g)) {
    const skill = findSkillByCommand(skills, match[2]);
    if (skill) ids.push(skill.id);
  }
  return uniqueSkillIds(ids);
}

function stripKnownSkillCommands(value: string, skills: AgentSkill[]) {
  return value
    .replace(/(^|\s)\/([a-zA-Z0-9:_-]+)/g, (match, prefix, command) => {
      return findSkillByCommand(skills, command) || command.toLowerCase() === "skills" ? prefix : match;
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function prepareAgentTurnDraft(value: string, selectedSkillIds: string[], skills: AgentSkill[]) {
  const skillIds = uniqueSkillIds([...selectedSkillIds, ...extractSkillIdsFromDraft(value, skills)]);
  const selectedSkills = skillIds
    .map((id) => skills.find((skill) => skill.id === id))
    .filter(Boolean)
    .map((skill) => ({ id: skill!.id, name: skill!.name }));
  const strippedBody = stripKnownSkillCommands(value, skills);
  const skillList = selectedSkills.map((skill) => `/${skill.id}`).join(", ");
  const body =
    strippedBody ||
    (selectedSkills.length > 0
      ? `Apply ${skillList} to the current writing context. If edits are useful, return them as reviewable suggestions or document proposals.`
      : "");
  const summary = strippedBody
    ? selectedSkills.length > 0
      ? `${strippedBody} (${skillList})`
      : strippedBody
    : selectedSkills.length > 0
      ? `Requested ${skillList} on the current writing context.`
      : "";

  return {
    body,
    displayBody: strippedBody,
    summary,
    skillIds,
    skills: selectedSkills
  };
}

function isOlderDocument(candidate: DocumentState, current: DocumentState | null) {
  if (!current) return false;
  if (candidate.id !== current.id) return false;
  const candidateTime = Date.parse(candidate.review?.updatedAt ?? "");
  const currentTime = Date.parse(current.review?.updatedAt ?? "");
  return Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime < currentTime;
}

function App() {
  const [documentState, setDocumentState] = useState<DocumentState | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultAppSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toneSetupInvocation, setToneSetupInvocation] = useState<ToneSetupInvocation | null>(null);
  const [settingsSaveState, setSettingsSaveState] = useState<SaveState>("saved");
  const [revisionState, setRevisionState] = useState<RevisionState>({ revisions: [], currentRevisionId: null });
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [agentRuntimeConfig, setAgentRuntimeConfig] = useState<AgentRuntimeConfig | null>(null);
  const [agentModelDraft, setAgentModelDraft] = useState("");
  const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);
  const [isAgentModelMenuOpen, setIsAgentModelMenuOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [panelMode, setPanelMode] = useState<PanelMode>("threads");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [isLeftRailCollapsed, setIsLeftRailCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [isRestoringRevision, setIsRestoringRevision] = useState(false);
  const [isRevisionHistoryOpen, setIsRevisionHistoryOpen] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [pendingSelectionDraft, setPendingSelectionDraft] = useState<SelectionDraft | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [newThreadSkillIds, setNewThreadSkillIds] = useState<string[]>([]);
  const [threadSkillIds, setThreadSkillIds] = useState<Record<string, string[]>>({});
  const [chatDraft, setChatDraft] = useState("");
  const [chatSkillIds, setChatSkillIds] = useState<string[]>([]);
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState | null>(null);
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<SelectionContextMenuState | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const [blockResetKeys, setBlockResetKeys] = useState<Record<string, number>>({});
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});
  const selectionRangeRef = useRef<Range | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const customSelectionActiveRef = useRef(false);
  const ignoreNextCanvasSelectionEventRef = useRef(false);
  const linkRangeRef = useRef<Range | null>(null);
  const linkTargetRef = useRef<LinkTargetState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const liveEditTimerRef = useRef<number | null>(null);
  const stateEpochRef = useRef(0);
  const stateRef = useRef<DocumentState | null>(null);
  const saveRef = useRef<SaveState>("loading");
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);
  const liveEditHistoryActiveRef = useRef(false);
  const historyRestoreRef = useRef(false);
  const agentSession = documentState?.agentSession;

  const clearPendingEditTimers = useCallback(() => {
    if (liveEditTimerRef.current) window.clearTimeout(liveEditTimerRef.current);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    liveEditTimerRef.current = null;
    saveTimerRef.current = null;
  }, []);

  const saveAgentRuntimeConfig = useCallback(
    async (nextConfig: { runtime: string; model: string; effort: string }) => {
      if (agentSession?.status === "running") return;

      setSaveState("saving");
      try {
        const updated = await updateAgentConfig(nextConfig);
        stateRef.current = updated.document;
        setDocumentState(updated.document);
        setAgentRuntimeConfig(updated.config);
        setAgentModelDraft(updated.config.configuredModel === "auto" ? "" : updated.config.configuredModel);
        if (updated.settings) {
          const savedSettings = mergeAppSettings(updated.settings);
          setAppSettings(savedSettings);
          setSettingsDraft(savedSettings);
        }
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [agentSession?.status]
  );

  useEffect(() => {
    Promise.all([fetchAppSettings(), fetchDocument(), fetchRevisionHistory(), fetchAgentSkills(), fetchAgentRuntimes()])
      .then(([settingsResponse, loaded, revisions, skills, runtimeConfig]) => {
        const loadedSettings = mergeAppSettings(settingsResponse.settings);
        setAppSettings(loadedSettings);
        setSettingsDraft(loadedSettings);
        setIsLeftRailCollapsed(loadedSettings.panelState.leftCollapsed);
        setIsRightPanelCollapsed(loadedSettings.panelState.rightCollapsed);
        setNewThreadSkillIds(loadedSettings.defaultSkills);
        setChatSkillIds(loadedSettings.defaultSkills);
        stateRef.current = loaded;
        setDocumentState(loaded);
        setRevisionState(revisions);
        setAgentSkills(skills);
        setAgentRuntimeConfig(runtimeConfig);
        setAgentModelDraft(runtimeConfig.configuredModel === "auto" ? "" : runtimeConfig.configuredModel);
        if (!loadedSettings.toneOfVoiceSetupComplete) setToneSetupInvocation("first-run");
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  }, []);

  useEffect(() => {
    saveRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    setSettingsDraft(appSettings);
    setSettingsSaveState("saved");
  }, [appSettings, isSettingsOpen]);

  useEffect(() => {
    const configuredModel = agentRuntimeConfig?.configuredModel ?? documentState?.agentSession?.configuredModel ?? "auto";
    const configuredRuntime = agentRuntimeConfig?.configuredRuntime ?? documentState?.agentSession?.configuredRuntime ?? "auto";
    const resolvedRuntime =
      agentRuntimeConfig?.resolvedRuntime ??
      (configuredRuntime === "auto" ? documentState?.agentSession?.runtime ?? null : configuredRuntime);

    if (
      agentRuntimeConfig &&
      modelIsAdvertisedByDifferentRuntime(configuredModel, resolvedRuntime, agentRuntimeConfig.runtimes)
    ) {
      setAgentModelDraft("");
      void saveAgentRuntimeConfig({
        runtime: configuredRuntime,
        model: "auto",
        effort: agentRuntimeConfig.configuredEffort ?? "auto"
      });
      return;
    }

    setAgentModelDraft(configuredModel === "auto" ? "" : configuredModel);
  }, [
    agentRuntimeConfig,
    documentState?.agentSession?.configuredModel,
    documentState?.agentSession?.configuredRuntime,
    documentState?.agentSession?.runtime,
    saveAgentRuntimeConfig
  ]);

  useEffect(() => {
    if (!linkPopover) return;
    window.requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
  }, [linkPopover]);

  useEffect(() => {
    return subscribeToDocumentEvents((remote) => {
      const current = stateRef.current;
      const switchedDocument = Boolean(current && remote.id !== current.id);
      if (isOlderDocument(remote, current)) return;
      const shouldSkipRender = switchedDocument ? false : shouldAvoidDocumentRenderWhileEditing(remote);
      if (switchedDocument) {
        clearPendingEditTimers();
        undoStackRef.current = [];
        redoStackRef.current = [];
        selectionRangeRef.current = null;
        linkRangeRef.current = null;
        linkTargetRef.current = null;
        stateEpochRef.current += 1;
        setActiveThreadId(null);
        setActiveBlockId(null);
        setSelectionDraft(null);
        setPendingSelectionDraft(null);
        setFloatingToolbar(null);
        setSelectionContextMenu(null);
        setLinkPopover(null);
        setReplyDrafts({});
        setThreadSkillIds({});
        setBlockResetKeys({});
        refreshRevisions();
      }
      stateRef.current = remote;
      if (!shouldSkipRender) setDocumentState(remote);
      if (remote.agentSession) {
        setAgentRuntimeConfig((current) =>
          current
            ? {
                ...current,
                configuredRuntime: remote.agentSession?.configuredRuntime ?? current.configuredRuntime,
                resolvedRuntime: remote.agentSession?.runtime ?? current.resolvedRuntime,
                configuredModel: remote.agentSession?.configuredModel ?? current.configuredModel,
                resolvedModel: remote.agentSession?.model ?? current.resolvedModel,
                configuredEffort: remote.agentSession?.configuredEffort ?? current.configuredEffort,
                resolvedEffort: remote.agentSession?.effort ?? current.resolvedEffort
              }
            : current
        );
      }
      if (saveRef.current !== "saving") setSaveState("saved");
    });
  }, [clearPendingEditTimers]);

  useEffect(() => {
    return clearPendingEditTimers;
  }, [clearPendingEditTimers]);

  useEffect(() => {
    const reposition = () => {
      const range = selectionRangeRef.current;
      if (!range) return;
      const position = getFloatingToolbarPosition(range);
      if (position) setFloatingToolbar(position);
    };

    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, []);

  const outline = useMemo(() => extractOutline(documentState?.markdown ?? ""), [documentState?.markdown]);
  const words = useMemo(() => wordCount(documentState?.markdown ?? ""), [documentState?.markdown]);
  const threads = documentState?.review.threads ?? emptyThreads;
  const showResolvedThreads = appSettings.showResolvedThreads;
  const visibleThreads = useMemo(
    () => (showResolvedThreads ? threads : threads.filter((thread) => thread.status !== "resolved")),
    [showResolvedThreads, threads]
  );
  const proposals = documentState?.review.proposals ?? emptyProposals;
  const reviewableProposals = useMemo(
    () =>
      proposals
        .filter((proposal) => proposal.status === "open" || proposal.status === "reviewed")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [proposals]
  );
  const activeInlineProposal = useMemo(() => {
    if (!documentState) return null;
    for (const proposal of reviewableProposals) {
      const review = buildInlineProposalReview(proposal, documentState.markdown);
      if (review.changes.some((change) => !change.decision)) return review;
    }
    return null;
  }, [documentState, reviewableProposals]);
  const contextLedger = documentState?.review.contextLedger ?? [];
  const activeThread = visibleThreads.find((thread) => thread.id === activeThreadId) ?? visibleThreads[0] ?? null;
  const openThreadCount = openThreads(threads).length;
  const resolvedThreadCount = threads.filter((thread) => thread.status === "resolved").length;
  function refreshRevisions() {
    fetchRevisionHistory()
      .then((revisions) => setRevisionState(revisions))
      .catch(() => undefined);
  }

  async function persistSettings(nextSettings: AppSettings, options: { closeDialog?: boolean } = {}) {
    const normalizedSettings = mergeAppSettings(nextSettings);
    setAppSettings(normalizedSettings);
    setSettingsDraft(normalizedSettings);
    setIsLeftRailCollapsed(normalizedSettings.panelState.leftCollapsed);
    setIsRightPanelCollapsed(normalizedSettings.panelState.rightCollapsed);
    if (!newComment.trim()) setNewThreadSkillIds(normalizedSettings.defaultSkills);
    if (!chatDraft.trim()) setChatSkillIds(normalizedSettings.defaultSkills);
    setSettingsSaveState("saving");
    try {
      const response = await updateAppSettings(normalizedSettings);
      const savedSettings = mergeAppSettings(response.settings);
      const runtimeConfig = await fetchAgentRuntimes();
      setAppSettings(savedSettings);
      setSettingsDraft(savedSettings);
      setAgentRuntimeConfig(runtimeConfig);
      setAgentModelDraft(runtimeConfig.configuredModel === "auto" ? "" : runtimeConfig.configuredModel);
      setIsLeftRailCollapsed(savedSettings.panelState.leftCollapsed);
      setIsRightPanelCollapsed(savedSettings.panelState.rightCollapsed);
      if (!newComment.trim()) setNewThreadSkillIds(savedSettings.defaultSkills);
      if (!chatDraft.trim()) setChatSkillIds(savedSettings.defaultSkills);
      setSettingsSaveState("saved");
      if (options.closeDialog) setIsSettingsOpen(false);
    } catch {
      setSettingsSaveState("error");
    }
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    setSettingsDraft((current) => ({
      ...current,
      ...patch
    }));
  }

  function saveSettingsDraft() {
    void persistSettings(settingsDraft, { closeDialog: true });
  }

  function toneSettingsBase() {
    return isSettingsOpen ? settingsDraft : appSettings;
  }

  async function saveToneOfVoiceSetup(toneOfVoice: string) {
    const nextSettings = mergeAppSettings({
      ...toneSettingsBase(),
      toneOfVoice,
      toneOfVoiceSetupComplete: true
    });
    await persistSettings(nextSettings);
    setToneSetupInvocation(null);
  }

  async function skipToneOfVoiceSetup() {
    const nextSettings = mergeAppSettings({
      ...toneSettingsBase(),
      toneOfVoiceSetupComplete: true
    });
    await persistSettings(nextSettings);
    setToneSetupInvocation(null);
  }

  function updatePanelState(patch: Partial<AppSettings["panelState"]>) {
    void persistSettings({
      ...appSettings,
      panelState: {
        ...appSettings.panelState,
        ...patch
      }
    });
  }

  function currentConfiguredRuntime() {
    return agentRuntimeConfig?.configuredRuntime ?? agentSession?.configuredRuntime ?? agentSession?.runtime ?? "auto";
  }

  function currentConfiguredModel() {
    return agentRuntimeConfig?.configuredModel ?? agentSession?.configuredModel ?? agentSession?.model ?? "auto";
  }

  function currentConfiguredEffort() {
    return agentRuntimeConfig?.configuredEffort ?? agentSession?.configuredEffort ?? agentSession?.effort ?? "auto";
  }

  function updateAgentRuntime(runtime: string) {
    setAgentModelDraft("");
    setIsAgentModelMenuOpen(false);
    void saveAgentRuntimeConfig({
      runtime,
      model: "auto",
      effort: "auto"
    });
  }

  function commitAgentModel(value: string) {
    const model = value.trim() || "auto";
    if (model === currentConfiguredModel()) return;
    void saveAgentRuntimeConfig({
      runtime: currentConfiguredRuntime(),
      model,
      effort: currentConfiguredEffort()
    });
  }

  function selectAgentModel(value: string) {
    setAgentModelDraft(value === "auto" ? "" : value);
    setIsAgentModelMenuOpen(false);
    commitAgentModel(value);
  }

  function updateAgentEffort(effort: string) {
    if (effort === currentConfiguredEffort()) return;
    void saveAgentRuntimeConfig({
      runtime: currentConfiguredRuntime(),
      model: currentConfiguredModel(),
      effort
    });
  }

  function snapshotFromState(state: DocumentState): HistorySnapshot {
    return {
      markdown: state.markdown,
      review: structuredClone(state.review)
    };
  }

  function comparableReviewPayload(review: DocumentState["review"]) {
    const { updatedAt: _updatedAt, ...payload } = review;
    return JSON.stringify(payload);
  }

  function snapshotsMatch(left: HistorySnapshot | null | undefined, right: HistorySnapshot | null | undefined) {
    return Boolean(
      left &&
        right &&
        left.markdown === right.markdown &&
        comparableReviewPayload(left.review) === comparableReviewPayload(right.review)
    );
  }

  function pushUndoSnapshot(state: DocumentState) {
    const snapshot = snapshotFromState(state);
    const last = undoStackRef.current.at(-1);
    if (snapshotsMatch(last, snapshot)) return;

    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-100);
    redoStackRef.current = [];
  }

  function pushRedoSnapshot(snapshot: HistorySnapshot) {
    const last = redoStackRef.current.at(-1);
    if (snapshotsMatch(last, snapshot)) return;

    redoStackRef.current = [...redoStackRef.current, snapshot].slice(-100);
  }

  function popDistinctSnapshot(stack: HistorySnapshot[], current: HistorySnapshot) {
    const nextStack = [...stack];
    let target = nextStack.pop() ?? null;

    while (target && snapshotsMatch(target, current)) {
      target = nextStack.pop() ?? null;
    }

    return { target, stack: nextStack };
  }

  function beginLiveEditHistory() {
    const current = stateRef.current;
    if (!current || liveEditHistoryActiveRef.current || historyRestoreRef.current) return;
    pushUndoSnapshot(current);
    liveEditHistoryActiveRef.current = true;
  }

  function clearEditorInteractionState() {
    window.getSelection()?.removeAllRanges();
    selectionRangeRef.current = null;
    customSelectionActiveRef.current = false;
    setPendingSelectionDraft(null);
    setFloatingToolbar(null);
    setLinkPopover(null);
    setSelectionContextMenu(null);
  }

  function restoreEditorHistory(direction: "undo" | "redo") {
    const current = stateRef.current;
    if (!current) return false;

    const liveState = stateWithPendingLiveCanvasEdit(current);
    const currentSnapshot = snapshotFromState(liveState);
    const sourceStack = direction === "undo" ? undoStackRef.current : redoStackRef.current;
    const { target, stack } = popDistinctSnapshot(sourceStack, currentSnapshot);
    if (!target) return false;

    if (direction === "undo") {
      undoStackRef.current = stack;
      pushRedoSnapshot(currentSnapshot);
    } else {
      redoStackRef.current = stack;
      const undoLast = undoStackRef.current.at(-1);
      if (!snapshotsMatch(undoLast, currentSnapshot)) {
        undoStackRef.current = [...undoStackRef.current, currentSnapshot].slice(-100);
      }
    }

    historyRestoreRef.current = true;
    liveEditHistoryActiveRef.current = false;
    const next: DocumentState = {
      ...liveState,
      markdown: target.markdown,
      review: {
        ...structuredClone(target.review),
        updatedAt: nowIso()
      }
    };
    setDocumentState(next);
    queueDocumentSave(next, { renderSavedState: true });
    historyRestoreRef.current = false;
    clearEditorInteractionState();
    return true;
  }

  function stateWithLiveCanvasEdit(state: DocumentState) {
    if (!canvasRef.current) return state;
    let markdown = state.markdown;
    try {
      markdown = serializeCanvasMarkdown(state.markdown);
    } catch (error) {
      console.error("Unable to serialize editor contents", error);
      setSaveState("error");
      return state;
    }

    if (markdown === state.markdown) return state;

    return {
      ...state,
      markdown,
      review: {
        ...state.review,
        updatedAt: nowIso()
      }
    };
  }

  function stateWithPendingLiveCanvasEdit(state: DocumentState) {
    return liveEditHistoryActiveRef.current || liveEditTimerRef.current !== null ? stateWithLiveCanvasEdit(state) : state;
  }

  function serializeCanvasMarkdown(markdown: string) {
    const blocks = parseMarkdownBlocks(markdown);
    if (blocks.length === 0) {
      const emptyBlockId = markdownBlockIdFromIndex(0);
      const node = blockRefs.current[emptyBlockId];
      const text = node ? blockNodeToMarkdown(node, "paragraph") : "";
      return serializeMarkdownBlocks(text.trim() ? [{ id: emptyBlockId, type: "paragraph", text }] : []);
    }

    return serializeMarkdownBlocks(
      blocks.flatMap((block) => {
        if (block.type === "image") return [block];
        const node = blockRefs.current[block.id];
        if (!node) return [block];
        const text = blockNodeToMarkdown(node, block.type);
        return text.trim() ? [{ ...block, text }] : [];
      })
    );
  }

  function blockNodeToMarkdown(node: HTMLElement, blockType?: string) {
    const html = blockType === "table" ? node.outerHTML : node.innerHTML;
    return htmlToInlineMarkdown(html.replace(/\u00a0/g, " ").trimEnd());
  }

  function isCanvasFocused() {
    return Boolean(canvasRef.current && document.activeElement && canvasRef.current.contains(document.activeElement));
  }

  function shouldAvoidDocumentRenderWhileEditing(remote: DocumentState) {
    const current = stateRef.current;
    return Boolean(isCanvasFocused() && current && remote.markdown === current.markdown);
  }

  function commitCanvasDom() {
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }

    const current = stateRef.current;
    if (!current) return;
    const next = stateWithLiveCanvasEdit(current);
    if (next === current) {
      if (documentState && current.markdown !== documentState.markdown) setDocumentState(current);
      liveEditHistoryActiveRef.current = false;
      return;
    }
    commit(() => next);
    liveEditHistoryActiveRef.current = false;
  }

  function scheduleLiveCanvasCommit() {
    beginLiveEditHistory();
    if (liveEditTimerRef.current) window.clearTimeout(liveEditTimerRef.current);
    liveEditTimerRef.current = window.setTimeout(() => {
      liveEditTimerRef.current = null;
      saveLiveCanvasDomQuietly();
      liveEditHistoryActiveRef.current = false;
    }, 1200);
  }

  function saveLiveCanvasDomQuietly() {
    const current = stateRef.current;
    if (!current) return;
    const next = stateWithLiveCanvasEdit(current);
    if (next === current) return;
    if (!liveEditHistoryActiveRef.current && !historyRestoreRef.current) pushUndoSnapshot(current);

    queueDocumentSave(next, { renderSavedState: false });
  }

  function commit(updater: (state: DocumentState) => DocumentState) {
    if (!stateRef.current) return null;

    const current = stateRef.current;
    let next: DocumentState;
    try {
      const base = stateWithPendingLiveCanvasEdit(current);
      next = updater(base);
      if (!historyRestoreRef.current && next.markdown !== base.markdown) {
        pushUndoSnapshot(base);
      } else if (
        !historyRestoreRef.current &&
        !liveEditHistoryActiveRef.current &&
        base.markdown !== current.markdown
      ) {
        pushUndoSnapshot(current);
      }
    } catch (error) {
      console.error("Unable to commit document update", error);
      setSaveState("error");
      return null;
    }

    setDocumentState(next);
    queueDocumentSave(next, { renderSavedState: true });
    liveEditHistoryActiveRef.current = false;

    return next;
  }

  function queueDocumentSave(next: DocumentState, { renderSavedState }: { renderSavedState: boolean }) {
    stateEpochRef.current += 1;
    const saveEpoch = stateEpochRef.current;
    stateRef.current = next;
    setSaveState("saving");

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveDocument(next)
        .then((saved) => {
          if (saveEpoch !== stateEpochRef.current || isOlderDocument(saved, stateRef.current)) return;
          const current = stateRef.current;
          const merged = current
            ? {
                ...saved,
                agentSession: current.agentSession ?? saved.agentSession
              }
            : saved;
          stateRef.current = merged;
          if (renderSavedState || !shouldAvoidDocumentRenderWhileEditing(merged)) setDocumentState(merged);
          setSaveState("saved");
          refreshRevisions();
        })
        .catch(() => {
          if (saveEpoch === stateEpochRef.current) setSaveState("error");
        });
    }, 350);
  }

  function requestThreadAgentReply(threadId: string) {
    const current = stateRef.current;
    const thread = current?.review.threads.find((item) => item.id === threadId);
    if (!current || !thread) return;

    const latestHumanMessage = [...thread.messages].reverse().find((message) => message.author === "human")?.body;
    const body = latestHumanMessage
      ? `Reply to this anchored thread. Human note: ${latestHumanMessage}`
      : `Reply to this anchored thread about: ${thread.anchor.exact}`;
    triggerAgent("thread", body, current, threadId);
  }

  function getFloatingToolbarPosition(range: Range): FloatingToolbarState | null {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const rect = rects[0] ?? range.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;

    const toolbarWidth = Math.min(430, window.innerWidth - 20);
    const toolbarHeight = 42;
    const margin = 10;
    const minLeft = margin + toolbarWidth / 2;
    const maxLeft = Math.max(minLeft, window.innerWidth - margin - toolbarWidth / 2);
    const placement = rect.top > toolbarHeight + margin * 2 ? "above" : "below";
    const top =
      placement === "above"
        ? Math.max(margin, rect.top - toolbarHeight - margin)
        : Math.min(window.innerHeight - toolbarHeight - margin, rect.bottom + margin);

    return {
      left: clamp(rect.left + rect.width / 2, minLeft, maxLeft),
      top,
      placement
    };
  }

  function getLinkPopoverPosition(range: Range): LinkPopoverState | null {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    const rect = rects[0] ?? range.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;

    const popoverWidth = 340;
    const popoverHeight = 46;
    const margin = 10;
    const hasRoomBelow = rect.bottom + popoverHeight + margin < window.innerHeight;

    return {
      left: clamp(rect.left + rect.width / 2, margin + popoverWidth / 2, window.innerWidth - margin - popoverWidth / 2),
      top: hasRoomBelow ? rect.bottom + margin : Math.max(margin, rect.top - popoverHeight - margin)
    };
  }

  function updateFloatingToolbarPosition() {
    const range = selectionRangeRef.current;
    if (!range || !canvasRef.current) return;

    try {
      if (!canvasRef.current.contains(range.startContainer) || !canvasRef.current.contains(range.endContainer)) return;
      const position = getFloatingToolbarPosition(range);
      if (position) setFloatingToolbar(position);
    } catch {
      selectionRangeRef.current = null;
      setFloatingToolbar(null);
    }
  }

  function clearCanvasSelectionState() {
    selectionRangeRef.current = null;
    selectionDragRef.current = null;
    customSelectionActiveRef.current = false;
    setPendingSelectionDraft(null);
    setFloatingToolbar(null);
    setLinkPopover(null);
    setSelectionContextMenu(null);
    linkRangeRef.current = null;
    linkTargetRef.current = null;
  }

  function selectEntireDocument() {
    const current = stateRef.current;
    if (!current) return false;

    const liveState = stateWithPendingLiveCanvasEdit(current);
    const exact = renderedMarkdownSnippet(liveState.markdown);
    const draft = buildSelectionFromMarkdownRange(liveState.markdown, 0, liveState.markdown.length) ?? {
      kind: "markdown-range" as const,
      exact,
      prefix: "",
      suffix: "",
      start: 0,
      end: liveState.markdown.length
    };
    if (!exact || draft.end <= draft.start) return false;

    if (liveState !== current) {
      commit(() => liveState);
    }

    customSelectionActiveRef.current = true;
    selectionRangeRef.current = null;
    setSelectionDraft(null);
    setPendingSelectionDraft(draft);
    setFloatingToolbar(null);
    setLinkPopover(null);
    setSelectionContextMenu(null);
    window.getSelection()?.removeAllRanges();
    canvasRef.current?.focus({ preventScroll: true });
    return true;
  }

  function isProposalReviewTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      Boolean(target.closest(".inline-proposal-review-bar, .inline-proposal-change"))
    );
  }

  function markdownForSelection() {
    return stateRef.current?.markdown ?? documentState?.markdown ?? "";
  }

  function editableBlockFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const direct = element ? closestEditableBlock(element) : null;
    if (direct) return direct;

    const shell = element instanceof Element ? element.closest<HTMLElement>("[data-block-shell]") : null;
    const shellBlock = shell?.querySelector<HTMLElement>("[data-block-id]");
    if (shellBlock) return shellBlock;

    const blocks = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []);
    if (blocks.length === 0) return null;

    const verticallyAligned = blocks.find((block) => {
      const rect = block.getBoundingClientRect();
      return clientY >= rect.top - 12 && clientY <= rect.bottom + 12;
    });
    if (verticallyAligned) return verticallyAligned;

    const nearest = blocks.reduce<{ block: HTMLElement; distance: number } | null>((current, block) => {
      const rect = block.getBoundingClientRect();
      const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
      return !current || distance < current.distance ? { block, distance } : current;
    }, null);

    return nearest && nearest.distance < 80 ? nearest.block : null;
  }

  function selectionEndpointFromBlockEdge(blockNode: HTMLElement, clientX: number, clientY: number): SelectionEndpoint | null {
    const markdown = markdownForSelection();
    const blockId = blockNode.dataset.blockId;
    if (!blockId || !markdown) return null;

    const block = parseMarkdownBlocks(markdown).find((item) => item.id === blockId);
    const span = getMarkdownBlockLineSpans(markdown).find((item) => item.id === blockId);
    if (!block || !span) return null;

    const rect = blockNode.getBoundingClientRect();
    const useStart =
      clientY < rect.top ||
      (clientY <= rect.bottom && clientY < rect.top + rect.height / 2 && clientX < rect.left + rect.width * 0.7);
    const plainOffset = useStart ? 0 : visibleMarkdownCharacters(block.text).length;
    const edge = useStart ? "start" : "end";

    return {
      blockId,
      sourceIndex: span.textStart + markdownOffsetFromPlainOffset(block.text, plainOffset, edge)
    };
  }

  function handleCanvasSelectionEvent(event: React.SyntheticEvent<HTMLElement>) {
    if (ignoreNextCanvasSelectionEventRef.current) {
      ignoreNextCanvasSelectionEventRef.current = false;
      return;
    }
    if (isProposalReviewTarget(event.target)) {
      clearCanvasSelectionState();
      return;
    }
    rememberCanvasSelection();
  }

  function getSelectionEndpointFromPoint(clientX: number, clientY: number): SelectionEndpoint | null {
    const markdown = markdownForSelection();
    if (!markdown) return null;

    const range = caretRangeFromPoint(clientX, clientY);
    if (!range) {
      const blockNode = editableBlockFromPoint(clientX, clientY);
      return blockNode ? selectionEndpointFromBlockEdge(blockNode, clientX, clientY) : null;
    }

    const blockNode = closestEditableBlock(range.startContainer);
    const blockId = blockNode?.dataset.blockId;
    if (!blockNode || !blockId) {
      const fallbackBlock = editableBlockFromPoint(clientX, clientY);
      return fallbackBlock ? selectionEndpointFromBlockEdge(fallbackBlock, clientX, clientY) : null;
    }

    const block = parseMarkdownBlocks(markdown).find((item) => item.id === blockId);
    const span = getMarkdownBlockLineSpans(markdown).find((item) => item.id === blockId);
    if (!block || !span) return null;

    const plainOffset = plainOffsetInEditableBlock(blockNode, range.startContainer, range.startOffset);
    return {
      blockId,
      sourceIndex: span.textStart + markdownOffsetFromPlainOffset(block.text, plainOffset, "start")
    };
  }

  function updateCrossBlockDragSelection(event: React.PointerEvent<HTMLElement>) {
    const drag = selectionDragRef.current;
    if (!drag) return null;

    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (moved < 6) return drag.draft;

    const endpoint = getSelectionEndpointFromPoint(event.clientX, event.clientY);
    if (!endpoint || endpoint.sourceIndex === drag.endpoint.sourceIndex) return drag.draft;
    if (endpoint.blockId === drag.endpoint.blockId) {
      if (drag.isSelecting) {
        drag.draft = null;
        drag.isSelecting = false;
        customSelectionActiveRef.current = false;
        setPendingSelectionDraft(null);
      }
      return null;
    }

    const markdown = markdownForSelection();
    const draft = buildSelectionFromMarkdownRange(markdown, drag.endpoint.sourceIndex, endpoint.sourceIndex);
    if (!draft) return drag.draft;

    drag.draft = draft;
    drag.isSelecting = true;
    customSelectionActiveRef.current = true;
    selectionRangeRef.current = null;
    setPendingSelectionDraft(draft);
    setFloatingToolbar(null);
    setLinkPopover(null);
    window.getSelection()?.removeAllRanges();

    try {
      event.currentTarget.setPointerCapture(drag.pointerId);
    } catch {
      // Pointer capture can fail after the browser has already released the pointer.
    }

    event.preventDefault();
    return draft;
  }

  function floatingToolbarPositionFromPoint(clientX: number, clientY: number): FloatingToolbarState {
    const above = clientY > 70;
    return {
      left: clamp(clientX, 90, window.innerWidth - 90),
      top: above ? clientY - 52 : clientY + 18,
      placement: above ? "above" : "below"
    };
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || isProposalReviewTarget(event.target)) return;

    setSelectionContextMenu(null);
    customSelectionActiveRef.current = false;
    setPendingSelectionDraft(null);
    const endpoint = getSelectionEndpointFromPoint(event.clientX, event.clientY);
    selectionDragRef.current = endpoint
      ? {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          endpoint,
          draft: null,
          isSelecting: false
        }
      : null;
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLElement>) {
    updateCrossBlockDragSelection(event);
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLElement>) {
    const drag = selectionDragRef.current;
    const draft = drag ? updateCrossBlockDragSelection(event) ?? drag.draft : null;
    selectionDragRef.current = null;
    if (drag) {
      try {
        event.currentTarget.releasePointerCapture(drag.pointerId);
      } catch {
        // It is fine if capture was never acquired.
      }
    }
    if (!drag || event.button !== 0) return;

    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
    if (moved < 6) return;
    if (!draft) return;

    ignoreNextCanvasSelectionEventRef.current = true;
    selectionRangeRef.current = null;
    event.currentTarget.focus({ preventScroll: true });
    setPendingSelectionDraft(draft);
    setFloatingToolbar(floatingToolbarPositionFromPoint(event.clientX, event.clientY));
    setLinkPopover(null);
  }

  function handleCanvasPointerCancel(event: React.PointerEvent<HTMLElement>) {
    const drag = selectionDragRef.current;
    selectionDragRef.current = null;
    if (drag?.isSelecting) {
      customSelectionActiveRef.current = false;
      setPendingSelectionDraft(null);
    }
    if (!drag) return;

    try {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // It is fine if capture was never acquired.
    }
  }

  function triggerAgent(
    source: "chat" | "thread",
    body: string,
    nextState: DocumentState | null,
    threadId?: string | null,
    skills: AgentSkillSelection[] = []
  ) {
    if (!nextState) return;
    sendAgentMessage({ source, body, threadId, document: nextState, skills })
      .then((remote) => {
        stateRef.current = remote;
        setDocumentState(remote);
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  }

  function rememberCanvasSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !canvasRef.current) {
      selectionRangeRef.current = null;
      if (customSelectionActiveRef.current) return;
      setPendingSelectionDraft(null);
      setFloatingToolbar(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.commonAncestorContainer)) return;
    if (selection.isCollapsed) {
      selectionRangeRef.current = null;
      if (customSelectionActiveRef.current) return;
      setPendingSelectionDraft(null);
      setFloatingToolbar(null);
      return;
    }

    const nextRange = range.cloneRange();
    selectionRangeRef.current = nextRange;
    customSelectionActiveRef.current = false;
    setPendingSelectionDraft(null);
    setFloatingToolbar(getFloatingToolbarPosition(nextRange));
  }

  function restoreCanvasSelection() {
    if (!selectionRangeRef.current || !canvasRef.current) return false;

    try {
      const range = selectionRangeRef.current;
      if (!canvasRef.current.contains(range.startContainer) || !canvasRef.current.contains(range.endContainer)) {
        selectionRangeRef.current = null;
        return false;
      }

      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      const position = getFloatingToolbarPosition(range);
      if (position) setFloatingToolbar(position);
      return true;
    } catch {
      selectionRangeRef.current = null;
      setFloatingToolbar(null);
      return false;
    }
  }

  function focusCanvasBlock(blockId: string) {
    setActiveBlockId((current) => (current === blockId ? current : blockId));
  }

  function getEditableBlockForRange(range: Range) {
    const startBlock = closestEditableBlock(range.startContainer);
    const endBlock = closestEditableBlock(range.endContainer);
    return startBlock && startBlock === endBlock ? startBlock : null;
  }

  function scrollToThreadAnchor(threadId: string) {
    const directTarget = canvasRef.current?.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
    if (directTarget) {
      directTarget.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      directTarget.classList.add("is-scroll-target");
      window.setTimeout(() => directTarget.classList.remove("is-scroll-target"), 1300);
      return;
    }

    const current = stateRef.current;
    const thread = current?.review.threads.find((item) => item.id === threadId);
    if (!current || !thread) return;

    const candidates = getThreadAnchorCandidates(thread);
    const targetBlock = parseMarkdownBlocks(current.markdown).find((block) =>
      candidates.some((candidate) => block.text.includes(candidate))
    );
    const blockNode = targetBlock ? blockRefs.current[targetBlock.id] : null;
    if (!blockNode) return;

    blockNode.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    blockNode.classList.add("is-scroll-target");
    window.setTimeout(() => blockNode.classList.remove("is-scroll-target"), 1300);
  }

  function activateThread(threadId: string, options: { scroll?: boolean; openPanel?: boolean } = {}) {
    setActiveThreadId(threadId);
    if (options.openPanel) setPanelMode("threads");
    if (options.scroll) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => scrollToThreadAnchor(threadId));
      });
    }
  }

  function startCommentFromSelection() {
    if (!documentState || !canvasRef.current) return;
    if (pendingSelectionDraft) {
      setSelectionDraft(pendingSelectionDraft);
      setPendingSelectionDraft(null);
      customSelectionActiveRef.current = false;
      setPanelMode("threads");
      setFloatingToolbar(null);
      return;
    }

    restoreCanvasSelection();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.startContainer) || !canvasRef.current.contains(range.endContainer)) return;

    const selectedText = selection.toString().replace(/\s+/g, " ").trim();
    if (selectedText.length < 3) return;

    const markdown = markdownForSelection();
    const nextSelection = buildSelectionFromCanvasRange(markdown, range) ?? buildSelection(markdown, selectedText);
    setSelectionDraft(nextSelection);
    setPanelMode("threads");
    setFloatingToolbar(null);
  }

  function deletePendingMarkdownSelection() {
    const draft = pendingSelectionDraft;
    if (!draft) return false;

    let didDelete = false;
    commit((state) => {
      const markdown = deleteSelectionDraftFromMarkdown(state.markdown, draft);
      if (!markdown) return state;
      didDelete = true;
      return {
        ...state,
        markdown,
        review: {
          ...state.review,
          updatedAt: nowIso()
        }
      };
    });

    if (!didDelete) return false;

    clearEditorInteractionState();
    return true;
  }

  function showTransientToast(label: string) {
    setLastCopied(label);
    window.setTimeout(() => setLastCopied(null), 1400);
  }

  function pendingSelectionClipboardPayload(): ClipboardPayload | null {
    const draft = pendingSelectionDraft;
    if (!draft) return null;

    const markdown = markdownForSelection();
    const range = resolveSelectionDraftRange(markdown, draft);
    if (!range || range.end <= range.start) {
      return draft.exact ? { plainText: draft.exact } : null;
    }

    const selectedMarkdown = markdown.slice(range.start, range.end);
    const plainText = markdownToClipboardText(selectedMarkdown) || draft.exact;
    return plainText ? { plainText, markdown: selectedMarkdown } : null;
  }

  function nativeSelectionClipboardPayload(): ClipboardPayload | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !canvasRef.current) return null;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.commonAncestorContainer)) return null;

    const plainText = selection.toString();
    return plainText.trim() ? { plainText } : null;
  }

  function activeSelectionClipboardPayload(): ClipboardPayload | null {
    return pendingSelectionClipboardPayload() ?? nativeSelectionClipboardPayload();
  }

  function hasActiveCanvasSelection() {
    return Boolean(activeSelectionClipboardPayload());
  }

  function currentMarkdownEditRange(markdown: string) {
    if (pendingSelectionDraft) return resolveSelectionDraftRange(markdown, pendingSelectionDraft);

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !canvasRef.current) return null;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.startContainer) || !canvasRef.current.contains(range.endContainer)) return null;

    if (!range.collapsed) {
      const selectedRange = buildSelectionFromCanvasRange(markdown, range);
      if (selectedRange) return resolveSelectionDraftRange(markdown, selectedRange);
    }

    const blockNode = closestEditableBlock(range.startContainer);
    const blockId = blockNode?.dataset.blockId;
    if (!blockNode || !blockId) return null;

    const blocks = parseMarkdownBlocks(markdown);
    if (blocks.length === 0 && blockId === markdownBlockIdFromIndex(0)) return { start: 0, end: 0 };

    const block = blocks.find((item) => item.id === blockId);
    const span = getMarkdownBlockLineSpans(markdown).find((item) => item.id === blockId);
    if (!block || !span) return null;

    const plainOffset = plainOffsetInEditableBlock(blockNode, range.startContainer, range.startOffset);
    const offset = span.textStart + markdownOffsetFromPlainOffset(block.text, plainOffset, "start");
    return { start: offset, end: offset };
  }

  function placeCaretAtPoint(clientX: number, clientY: number) {
    if (!canvasRef.current) return false;

    const range = caretRangeFromPoint(clientX, clientY);
    if (!range || !canvasRef.current.contains(range.startContainer)) return false;

    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    selectionRangeRef.current = range.cloneRange();
    const blockId = closestEditableBlock(range.startContainer)?.dataset.blockId;
    if (blockId) focusCanvasBlock(blockId);
    return true;
  }

  function setClipboardEventPayload(clipboardData: DataTransfer, payload: ClipboardPayload) {
    clipboardData.setData("text/plain", payload.plainText);
    if (payload.markdown) clipboardData.setData("text/markdown", payload.markdown);
  }

  async function writeClipboardPayload(payload: ClipboardPayload, label: string) {
    try {
      await navigator.clipboard.writeText(payload.plainText);
      showTransientToast(label);
      return true;
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = payload.plainText;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);
      showTransientToast(copied ? label : "Copy failed");
      return copied;
    }
  }

  function applyClipboardTextPaste(text: string, options: { asMarkdown: boolean }) {
    if (!text) return false;

    const current = stateRef.current;
    if (!current) return false;

    const liveState = stateWithLiveCanvasEdit(current);
    const range = currentMarkdownEditRange(liveState.markdown);
    if (!range) return false;

    const blockMode = options.asMarkdown && shouldPasteAsMarkdownBlocks(text);
    const insertion = options.asMarkdown ? normalizeMarkdownPaste(text) : text.replace(/\r\n/g, "\n");
    const markdown = spliceMarkdownPaste(liveState.markdown, range.start, range.end, insertion, blockMode);
    if (markdown === liveState.markdown) return false;

    commit(() => ({
      ...liveState,
      markdown,
      review: {
        ...liveState.review,
        updatedAt: nowIso()
      }
    }));
    clearCanvasSelectionState();
    showTransientToast(options.asMarkdown ? "Markdown pasted" : "Text pasted");
    return true;
  }

  function insertMarkdownBlockAtCurrentRange(insertion: string, label: string) {
    const current = stateRef.current;
    if (!current || !insertion.trim()) return false;

    const liveState = stateWithLiveCanvasEdit(current);
    const range = currentMarkdownEditRange(liveState.markdown) ?? {
      start: liveState.markdown.length,
      end: liveState.markdown.length
    };
    const markdown = spliceMarkdownPaste(liveState.markdown, range.start, range.end, insertion, true);
    if (markdown === liveState.markdown) return false;

    commit(() => ({
      ...liveState,
      markdown,
      review: {
        ...liveState.review,
        updatedAt: nowIso()
      }
    }));
    clearCanvasSelectionState();
    showTransientToast(label);
    return true;
  }

  function isImageFile(file: File | null | undefined) {
    return Boolean(file && file.type.startsWith("image/"));
  }

  async function insertImageFile(file: File) {
    if (!isImageFile(file)) {
      showTransientToast("Unsupported image file");
      return false;
    }

    try {
      const asset = await uploadImageAsset(file);
      return insertMarkdownBlockAtCurrentRange(asset.markdown, "Image inserted");
    } catch (error) {
      console.error("Unable to insert image", error);
      showTransientToast("Image insert failed");
      return false;
    }
  }

  async function insertImageFiles(files: FileList | File[]) {
    const images = Array.from(files).filter(isImageFile);
    if (images.length === 0) return false;
    for (const image of images) {
      await insertImageFile(image);
    }
    return true;
  }

  async function pasteClipboardFromMenu(asMarkdown: boolean) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showTransientToast("Clipboard is empty");
        return;
      }
      if (!applyClipboardTextPaste(text, { asMarkdown })) showTransientToast("Paste failed");
    } catch {
      showTransientToast("Clipboard unavailable");
    } finally {
      setSelectionContextMenu(null);
    }
  }

  async function copyActiveSelectionToClipboard(label = "Selection copied") {
    const payload = activeSelectionClipboardPayload();
    if (!payload) return false;
    setSelectionContextMenu(null);
    return writeClipboardPayload(payload, label);
  }

  async function copyPendingSelectionToClipboard(label = "Selection copied") {
    const payload = pendingSelectionClipboardPayload();
    if (!payload) return false;
    setSelectionContextMenu(null);
    return writeClipboardPayload(payload, label);
  }

  function deleteNativeSelectionFromCanvas() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !canvasRef.current) return false;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.commonAncestorContainer)) return false;

    const editableBlock = getEditableBlockForRange(range);
    const blockId = editableBlock?.dataset.blockId;
    if (!editableBlock || !blockId) return false;

    range.deleteContents();
    updateCanvasBlock(blockId, editableBlock.innerHTML);
    selection.removeAllRanges();
    return true;
  }

  async function cutActiveSelectionToClipboard() {
    const copied = await copyActiveSelectionToClipboard("Selection cut");
    if (!copied) return false;
    return pendingSelectionDraft ? deletePendingMarkdownSelection() : deleteNativeSelectionFromCanvas();
  }

  function handleCanvasCopy(event: React.ClipboardEvent<HTMLElement>) {
    if (!pendingSelectionDraft) return;

    const payload = activeSelectionClipboardPayload();
    if (!payload) return;

    event.preventDefault();
    setClipboardEventPayload(event.clipboardData, payload);
    showTransientToast("Selection copied");
  }

  function handleCanvasCut(event: React.ClipboardEvent<HTMLElement>) {
    if (!pendingSelectionDraft) return;

    const payload = activeSelectionClipboardPayload();
    if (!payload) return;

    event.preventDefault();
    setClipboardEventPayload(event.clipboardData, payload);
    deletePendingMarkdownSelection();
    showTransientToast("Selection cut");
  }

  function handleCanvasPaste(event: React.ClipboardEvent<HTMLElement>) {
    const imageFiles = Array.from(event.clipboardData.files).filter(isImageFile);
    if (imageFiles.length > 0) {
      event.preventDefault();
      void insertImageFiles(imageFiles);
      return;
    }

    const explicitMarkdown = event.clipboardData.getData("text/markdown");
    const plainText = event.clipboardData.getData("text/plain");
    const text = explicitMarkdown || plainText;
    if (!text) return;

    const shouldIntercept =
      Boolean(explicitMarkdown) || Boolean(pendingSelectionDraft) || looksLikeMarkdownPaste(plainText);
    if (!shouldIntercept) return;

    event.preventDefault();
    const asMarkdown = Boolean(explicitMarkdown) || looksLikeMarkdownPaste(text);
    if (!applyClipboardTextPaste(text, { asMarkdown })) {
      showTransientToast("Paste failed");
    }
  }

  function handleCanvasDragOver(event: React.DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleCanvasDrop(event: React.DragEvent<HTMLElement>) {
    const imageFiles = Array.from(event.dataTransfer.files).filter(isImageFile);
    if (imageFiles.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    placeCaretAtPoint(event.clientX, event.clientY);
    void insertImageFiles(imageFiles);
  }

  function handleCanvasContextMenu(event: React.MouseEvent<HTMLElement>) {
    if (!canvasRef.current?.contains(event.target as Node)) return;

    event.preventDefault();
    const hasSelection = hasActiveCanvasSelection();
    if (!hasSelection) placeCaretAtPoint(event.clientX, event.clientY);

    setSelectionContextMenu({
      left: clamp(event.clientX, 8, window.innerWidth - 220),
      top: clamp(event.clientY, 8, window.innerHeight - 170),
      hasSelection
    });
  }

  function handleCanvasKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const key = event.key.toLowerCase();
    const isCommand = event.metaKey || event.ctrlKey;

    if (!event.defaultPrevented && isCommand && !event.shiftKey && key === "a") {
      if (selectEntireDocument()) event.preventDefault();
      return;
    }

    if (event.defaultPrevented || !pendingSelectionDraft) return;

    if (isCommand && !event.shiftKey && key === "c") {
      event.preventDefault();
      void copyPendingSelectionToClipboard();
      return;
    }
    if (isCommand && !event.shiftKey && key === "x") {
      event.preventDefault();
      void cutActiveSelectionToClipboard();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      deletePendingMarkdownSelection();
    }
  }

  function addThread() {
    const prepared = prepareAgentTurnDraft(newComment, newThreadSkillIds, agentSkills);
    if (!selectionDraft || !prepared.body) return;

    const createdAt = nowIso();
    const thread: ReviewThread = {
      id: makeId("thread"),
      status: "open",
      anchor: selectionDraft,
      messages: [
        {
          id: makeId("msg"),
          author: "human",
          body: prepared.displayBody,
          createdAt,
          skills: prepared.skills
        }
      ],
      suggestions: [],
      createdAt,
      updatedAt: createdAt
    };
    const ledgerEvent = createLedgerEvent({
      type: "thread_created",
      actor: "human",
      summary: `Created anchored thread on "${selectionDraft.exact}" with note: ${prepared.summary}`,
      createdAt,
      threadId: thread.id,
      metadata: {
        anchorStart: selectionDraft.start,
        anchorEnd: selectionDraft.end
      }
    });

    const nextState = commit((state) => ({
      ...state,
      review: {
        ...state.review,
        title: state.review.title || titleFromMarkdown(state.markdown),
        threads: [thread, ...state.review.threads],
        contextLedger: appendLedgerEvents(state.review.contextLedger, [ledgerEvent]),
        updatedAt: createdAt
      }
    }));
    if (appSettings.autoReplyToComments) {
      triggerAgent("thread", prepared.body, nextState, thread.id, prepared.skills);
    }

    setActiveThreadId(thread.id);
    setSelectionDraft(null);
    setPendingSelectionDraft(null);
    setNewComment("");
    setNewThreadSkillIds(appSettings.defaultSkills);
    selectionRangeRef.current = null;
    setFloatingToolbar(null);
    window.getSelection()?.removeAllRanges();
  }

  function addThreadMessage(threadId: string) {
    const prepared = prepareAgentTurnDraft(replyDrafts[threadId] ?? "", threadSkillIds[threadId] ?? [], agentSkills);
    if (!prepared.body) return;

    const createdAt = nowIso();
    const nextState = commit((state) => {
      const thread = state.review.threads.find((item) => item.id === threadId);
      const ledgerEvent = createLedgerEvent({
        type: "thread_message",
        actor: "human",
        summary: `Human replied to thread${thread ? ` on "${thread.anchor.exact}"` : ""}: ${prepared.summary}`,
        createdAt,
        threadId
      });
      return {
        ...state,
        review: {
          ...state.review,
          threads: state.review.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: [
                    ...thread.messages,
                    {
                      id: makeId("msg"),
                      author: "human",
                      body: prepared.displayBody,
                      createdAt,
                      skills: prepared.skills
                    }
                  ],
                  updatedAt: createdAt
                }
              : thread
          ),
          contextLedger: appendLedgerEvents(state.review.contextLedger, [ledgerEvent]),
          updatedAt: createdAt
        }
      };
    });
    triggerAgent("thread", prepared.body, nextState, threadId, prepared.skills);

    setReplyDrafts((drafts) => ({ ...drafts, [threadId]: "" }));
    setThreadSkillIds((drafts) => ({ ...drafts, [threadId]: appSettings.defaultSkills }));
  }

  function updateThreadStatus(threadId: string, status: "open" | "resolved") {
    const updatedAt = nowIso();
    commit((state) => {
      const thread = state.review.threads.find((item) => item.id === threadId);
      return {
        ...state,
        review: {
          ...state.review,
          threads: state.review.threads.map((thread) =>
            thread.id === threadId ? { ...thread, status, updatedAt } : thread
          ),
          contextLedger: appendLedgerEvents(state.review.contextLedger, [
            createLedgerEvent({
              type: "thread_status",
              actor: "human",
              summary: `${status === "resolved" ? "Resolved" : "Reopened"} thread${thread ? ` on "${thread.anchor.exact}"` : ""}.`,
              createdAt: updatedAt,
              threadId
            })
          ]),
          updatedAt
        }
      };
    });
  }

  function updateSuggestionStatus(threadId: string, suggestionId: string, status: "accepted" | "rejected") {
    const updatedAt = nowIso();
    commit((state) => {
      const thread = state.review.threads.find((item) => item.id === threadId);
      const suggestion = thread?.suggestions.find((item) => item.id === suggestionId);
      const markdown =
        status === "accepted" && thread && suggestion
          ? applyThreadSuggestionToMarkdown(state.markdown, thread, suggestion)
          : state.markdown;

      return {
        ...state,
        markdown,
        review: {
          ...state.review,
          threads: state.review.threads.map((item) =>
            item.id === threadId
              ? {
                  ...item,
                  suggestions: item.suggestions.map((candidate) =>
                    candidate.id === suggestionId ? { ...candidate, status } : candidate
                  ),
                  updatedAt
                }
              : item
          ),
          contextLedger: appendLedgerEvents(state.review.contextLedger, [
            suggestion
              ? createLedgerEvent({
                  type: "thread_suggestion_decision",
                  actor: "human",
                  summary: `${status === "accepted" ? "Accepted" : "Rejected"} thread suggestion: "${suggestion.original}" -> "${suggestion.replacement}"`,
                  createdAt: updatedAt,
                  threadId,
                  metadata: {
                    status
                  }
                })
              : null
          ]),
          updatedAt
        }
      };
    });
  }

  function updateProposalStatus(proposalId: string, status: "accepted" | "rejected") {
    const updatedAt = nowIso();
    commit((state) => {
      const proposal = state.review.proposals.find((item) => item.id === proposalId);
      const decisions =
        proposal && status === "accepted"
          ? Object.fromEntries(getProposalChangeBlocks(buildProposalDiff(proposal)).map((change) => [change.key, "accepted" as const]))
          : proposal && status === "rejected"
            ? Object.fromEntries(getProposalChangeBlocks(buildProposalDiff(proposal)).map((change) => [change.key, "rejected" as const]))
            : {};
      const markdown = proposal ? applyProposalDecisionTransitions(state.markdown, proposal, decisions) : state.markdown;
      return {
        ...state,
        markdown,
        review: {
          ...state.review,
          proposals: state.review.proposals.map((item) =>
            item.id === proposalId ? { ...item, status, changeDecisions: decisions } : item
          ),
          contextLedger: appendLedgerEvents(state.review.contextLedger, [
            proposal
              ? createLedgerEvent({
                  type: "proposal_decision",
                  actor: "human",
                  summary: `${status === "accepted" ? "Accepted all changes in" : "Declined"} proposal "${proposal.title}".`,
                  createdAt: updatedAt,
                  proposalId,
                  metadata: {
                    status,
                    changedBlocks: Object.keys(decisions).length
                  }
                })
              : null
          ]),
          updatedAt
        }
      };
    });
  }

  function updateProposalChangeDecision(
    proposalId: string,
    changeKey: string,
    decision: ProposalChangeDecision
  ) {
    const updatedAt = nowIso();
    commit((state) => {
      const proposal = state.review.proposals.find((item) => item.id === proposalId);
      if (!proposal) return state;

      const nextDecisions = {
        ...(proposal.changeDecisions ?? {}),
        [changeKey]: decision
      };
      const changes = getProposalChangeBlocks(buildProposalDiff(proposal));
      const status = resolveProposalStatus(changes, nextDecisions);
      const markdown = changes.some((item) => item.key === changeKey)
        ? applyProposalDecisionTransitions(state.markdown, proposal, nextDecisions)
        : state.markdown;

      return {
        ...state,
        markdown,
        review: {
          ...state.review,
          proposals: state.review.proposals.map((item) =>
            item.id === proposalId ? { ...item, changeDecisions: nextDecisions, status } : item
          ),
          contextLedger: appendLedgerEvents(state.review.contextLedger, [
            createLedgerEvent({
              type: "proposal_change_decision",
              actor: "human",
              summary: `${decision === "accepted" ? "Accepted" : "Declined"} change block ${changeKey} in proposal "${proposal.title}".`,
              createdAt: updatedAt,
              proposalId,
              changeKey,
              metadata: {
                decision,
                proposalStatus: status
              }
            })
          ]),
          updatedAt
        }
      };
    });
  }

  function requestProposalRevision(proposalId: string, change: ProposalChangeBlock, instruction: string) {
    const proposal = stateRef.current?.review.proposals.find((item) => item.id === proposalId);
    const body = instruction.trim();
    if (!proposal || !body) return;

    const messageBody = [
      `Please respond to this revision comment by updating change ${change.ordinal} in proposal "${proposal.title}".`,
      `Human revision comment: ${body}`,
      `Original block:\n${trimBlockText(change.deletions)}`,
      `Proposed block:\n${trimBlockText(change.additions)}`,
      "Do not update the document directly.",
      "Return a new documentProposals entry with a revised full replacementMarkdown so I can review it as a diff."
    ].join("\n\n");
    const createdAt = nowIso();
    const message: ChatMessage = {
      id: makeId("chat"),
      author: "human",
      body: messageBody,
      createdAt
    };

    const nextState = commit((state) => ({
      ...state,
      review: {
        ...state.review,
        chat: [...state.review.chat, message],
        contextLedger: appendLedgerEvents(state.review.contextLedger, [
          createLedgerEvent({
            type: "proposal_revision_requested",
            actor: "human",
            summary: `Requested revision for change ${change.ordinal} in proposal "${proposal.title}": ${body}`,
            createdAt,
            proposalId,
            changeKey: change.key
          })
        ]),
        updatedAt: createdAt
      }
    }));

    triggerAgent("chat", messageBody, nextState);
  }

  function requestProposalRewrite(proposalId: string) {
    const proposal = stateRef.current?.review.proposals.find((item) => item.id === proposalId);
    if (!proposal) return;

    const messageBody = [
      `Please rewrite proposal "${proposal.title}".`,
      "Keep the same editorial intent, but produce a cleaner and stronger proposed version.",
      `Existing proposal summary: ${proposal.summary}`,
      "Do not update the document directly.",
      "Return a new documentProposals entry with a revised full replacementMarkdown so I can review it inline."
    ].join("\n\n");
    const createdAt = nowIso();
    const message: ChatMessage = {
      id: makeId("chat"),
      author: "human",
      body: messageBody,
      createdAt
    };

    const nextState = commit((state) => ({
      ...state,
      review: {
        ...state.review,
        chat: [...state.review.chat, message],
        contextLedger: appendLedgerEvents(state.review.contextLedger, [
          createLedgerEvent({
            type: "proposal_revision_requested",
            actor: "human",
            summary: `Requested one-click rewrite for proposal "${proposal.title}".`,
            createdAt,
            proposalId
          })
        ]),
        updatedAt: createdAt
      }
    }));

    triggerAgent("chat", messageBody, nextState);
  }

  function addChatMessage() {
    const prepared = prepareAgentTurnDraft(chatDraft, chatSkillIds, agentSkills);
    if (!prepared.body) return;

    const createdAt = nowIso();
    const message: ChatMessage = {
      id: makeId("chat"),
      author: "human",
      body: prepared.displayBody,
      createdAt,
      skills: prepared.skills
    };

    const nextState = commit((state) => ({
      ...state,
      review: {
        ...state.review,
        chat: [...state.review.chat, message],
        contextLedger: appendLedgerEvents(state.review.contextLedger, [
          createLedgerEvent({
            type: "chat_message",
            actor: "human",
            summary: `Human chat message: ${prepared.summary}`,
            createdAt
          })
        ]),
        updatedAt: createdAt
      }
    }));
    triggerAgent("chat", prepared.body, nextState, undefined, prepared.skills);

    setChatDraft("");
    setChatSkillIds(appSettings.defaultSkills);
  }

  function updateCanvasBlock(blockId: string, html: string) {
    const currentBlock = stateRef.current ? parseMarkdownBlocks(stateRef.current.markdown).find((block) => block.id === blockId) : null;
    const registeredNode = blockRefs.current[blockId] ?? null;
    const text = registeredNode ? blockNodeToMarkdown(registeredNode, currentBlock?.type) : htmlToInlineMarkdown(html);
    const textBlocks = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    if (currentBlock && textBlocks.length > 1 && textBlocks[0] === currentBlock.text.trim()) {
      setBlockResetKeys((keys) => ({
        ...keys,
        [blockId]: (keys[blockId] ?? 0) + 1
      }));
    }
    commit((state) => ({
      ...state,
      markdown: updateMarkdownBlock(state.markdown, blockId, text),
      review: {
        ...state.review,
        updatedAt: nowIso()
      }
    }));
  }

  function moveCanvasBlock(blockId: string, targetBlockId: string, placement: BlockDropPlacement) {
    if (blockId === targetBlockId) return;
    commit((state) => ({
      ...state,
      markdown: moveMarkdownBlock(state.markdown, blockId, targetBlockId, placement),
      review: {
        ...state.review,
        updatedAt: nowIso()
      }
    }));
  }

  function deleteCanvasBlock(blockId: string) {
    if (!stateRef.current || !parseMarkdownBlocks(stateRef.current.markdown).some((item) => item.id === blockId)) return;
    commit((state) => ({
      ...state,
      markdown: deleteMarkdownBlock(state.markdown, blockId),
      review: {
        ...state.review,
        updatedAt: nowIso()
      }
    }));
    if (activeBlockId === blockId) setActiveBlockId(null);
  }

  function registerBlockRef(blockId: string, node: HTMLElement | null) {
    blockRefs.current[blockId] = node;
  }

  function updateBlockShape(blockId: string, patch: Parameters<typeof updateMarkdownBlockShape>[2]) {
    const node = blockRefs.current[blockId];
    const currentBlock = stateRef.current ? parseMarkdownBlocks(stateRef.current.markdown).find((block) => block.id === blockId) : null;
    const currentText = node ? blockNodeToMarkdown(node, currentBlock?.type) : null;

    commit((state) => {
      const markdownWithLatestText = currentText
        ? updateMarkdownBlock(state.markdown, blockId, currentText)
        : state.markdown;
      return {
        ...state,
        markdown: updateMarkdownBlockShape(markdownWithLatestText, blockId, patch),
        review: {
          ...state.review,
          updatedAt: nowIso()
        }
      };
    });
  }

  function updateActiveBlockShape(patch: Parameters<typeof updateMarkdownBlockShape>[2]) {
    if (!activeBlockId) return;
    updateBlockShape(activeBlockId, patch);
  }

  function applyInlineCommand(command: "bold" | "italic" | "strikeThrough") {
    restoreCanvasSelection();
    document.execCommand(command);
    rememberCanvasSelection();
  }

  function applyInlineCode() {
    restoreCanvasSelection();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!canvasRef.current?.contains(range.commonAncestorContainer)) return;

    const code = document.createElement("code");
    code.textContent = selection.toString();
    range.deleteContents();
    range.insertNode(code);
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(code);
    selection.addRange(nextRange);
    rememberCanvasSelection();
  }

  function insertEditorBreak(paragraphBreak: boolean) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current?.contains(range.commonAncestorContainer)) return false;

    range.deleteContents();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement("br"));
    if (paragraphBreak) fragment.appendChild(document.createElement("br"));

    const marker = document.createTextNode("\u200B");
    fragment.appendChild(marker);
    range.insertNode(fragment);

    const nextRange = document.createRange();
    nextRange.setStart(marker, marker.textContent?.length ?? 0);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    return true;
  }

  function openLinkPopover() {
    restoreCanvasSelection();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !canvasRef.current) return;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.commonAncestorContainer)) return;
    const editableBlock = getEditableBlockForRange(range);
    const blockId = editableBlock?.dataset.blockId;
    if (!editableBlock || !blockId) return;

    const startElement =
      range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const existingHref = startElement?.closest("a")?.getAttribute("href") ?? "";
    const position = getLinkPopoverPosition(range);
    if (!position) return;

    const selectedText = range.toString();
    const beforeSelection = range.cloneRange();
    beforeSelection.selectNodeContents(editableBlock);
    beforeSelection.setEnd(range.startContainer, range.startOffset);
    const plainStart = beforeSelection.toString().length;
    const savedRange = range.cloneRange();
    selectionRangeRef.current = savedRange.cloneRange();
    linkRangeRef.current = savedRange;
    linkTargetRef.current = {
      blockId,
      selectedText,
      plainStart,
      plainEnd: plainStart + selectedText.length,
      markdownAtOpen: blockNodeToMarkdown(
        editableBlock,
        stateRef.current ? parseMarkdownBlocks(stateRef.current.markdown).find((block) => block.id === blockId)?.type : undefined
      )
    };
    setLinkDraft(existingHref || "https://");
    setLinkPopover(position);
    setFloatingToolbar(null);
  }

  function applyLink() {
    const href = normalizeLinkHref(linkDraft);
    const target = linkTargetRef.current;
    const currentState = stateRef.current;
    if (href && target && currentState) {
      const block = parseMarkdownBlocks(currentState.markdown).find((item) => item.id === target.blockId);
      const linkedText = block ? applyMarkdownLinkToSelection(block.text, target, href) : null;
      if (block && linkedText && linkedText !== block.text) {
        commit((state) => ({
          ...state,
          markdown: updateMarkdownBlock(state.markdown, target.blockId, linkedText),
          review: {
            ...state.review,
            updatedAt: nowIso()
          }
        }));

        window.getSelection()?.removeAllRanges();
        selectionRangeRef.current = null;
        linkRangeRef.current = null;
        linkTargetRef.current = null;
        setFloatingToolbar(null);
        setLinkPopover(null);
        setLinkDraft("");
        return;
      }
    }

    const range = linkRangeRef.current?.cloneRange() ?? selectionRangeRef.current?.cloneRange();
    if (!href || !range || !canvasRef.current) return;

    try {
      if (!canvasRef.current.contains(range.commonAncestorContainer) || range.collapsed) return;

      const editableBlock = getEditableBlockForRange(range);
      const blockId = editableBlock?.dataset.blockId;
      if (!editableBlock || !blockId) return;

      const selectedText = range.toString();
      if (!selectedText.trim()) return;

      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer");
      anchor.textContent = selectedText;

      range.deleteContents();
      range.insertNode(anchor);

      updateCanvasBlock(blockId, editableBlock.innerHTML);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.setStartAfter(anchor);
      nextRange.collapse(true);
      selection?.addRange(nextRange);

      selectionRangeRef.current = null;
      linkRangeRef.current = null;
      linkTargetRef.current = null;
      setFloatingToolbar(null);
      setLinkPopover(null);
      setLinkDraft("");
    } catch {
      selectionRangeRef.current = null;
      linkRangeRef.current = null;
      linkTargetRef.current = null;
    }
  }

  function handleEditorShortcut(event: React.KeyboardEvent<HTMLElement>, blockId: string) {
    const isCommand = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (isCommand && !event.shiftKey && key === "a") {
      if (selectEntireDocument()) event.preventDefault();
      return;
    }

    if (isCommand && !event.shiftKey && key === "z" && restoreEditorHistory("undo")) {
      event.preventDefault();
      return;
    }
    if (isCommand && ((event.shiftKey && key === "z") || key === "y") && restoreEditorHistory("redo")) {
      event.preventDefault();
      return;
    }

    if (isCommand && !event.shiftKey && key === "c" && pendingSelectionDraft) {
      event.preventDefault();
      void copyPendingSelectionToClipboard();
      return;
    }
    if (isCommand && !event.shiftKey && key === "x" && pendingSelectionDraft) {
      event.preventDefault();
      void cutActiveSelectionToClipboard();
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && pendingSelectionDraft) {
      event.preventDefault();
      deletePendingMarkdownSelection();
      return;
    }

    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.nativeEvent.isComposing) {
      const currentBlock = stateRef.current ? parseMarkdownBlocks(stateRef.current.markdown).find((block) => block.id === blockId) : null;
      event.preventDefault();
      setActiveBlockId(blockId);
      insertEditorBreak(currentBlock?.type !== "code" && !event.shiftKey);
      rememberCanvasSelection();
      return;
    }

    if (!isCommand) return;

    if (key === "b") {
      event.preventDefault();
      applyInlineCommand("bold");
      return;
    }
    if (key === "i") {
      event.preventDefault();
      applyInlineCommand("italic");
      return;
    }
    if (key === "`") {
      event.preventDefault();
      applyInlineCode();
      return;
    }
    if (key === "k") {
      event.preventDefault();
      openLinkPopover();
      return;
    }
    if (event.altKey && ["0", "1", "2", "3"].includes(key)) {
      event.preventDefault();
      setActiveBlockId(blockId);
      if (key === "0") updateBlockShape(blockId, { type: "paragraph", level: undefined });
      if (key === "1") updateBlockShape(blockId, { type: "heading", level: 1 });
      if (key === "2") updateBlockShape(blockId, { type: "heading", level: 2 });
      if (key === "3") updateBlockShape(blockId, { type: "heading", level: 3 });
      return;
    }
    if (event.shiftKey && key === "7") {
      event.preventDefault();
      setActiveBlockId(blockId);
      updateBlockShape(blockId, { type: "ordered-list", marker: "1" });
      return;
    }
    if (event.shiftKey && key === "8") {
      event.preventDefault();
      setActiveBlockId(blockId);
      updateBlockShape(blockId, { type: "unordered-list" });
    }
  }

  async function copyText(text: string, label: string) {
    await writeClipboardPayload({ plainText: text }, label);
  }

  function exportMarkdown() {
    if (!documentState) return;
    const blob = new Blob([documentState.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeDownloadName(documentState.review.title || "draft")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const notifyTableImageExported = useCallback((status: "success" | "error") => {
    setLastCopied(status === "success" ? "Table image downloaded" : "Table image export failed");
    window.setTimeout(() => setLastCopied(null), 1600);
  }, []);

  async function importMarkdown(file: File) {
    const markdown = await file.text();
    const createdAt = nowIso();
    commit((state) => ({
      ...state,
      markdown,
      review: {
        ...state.review,
        title: file.name.replace(/\.md$/i, "") || titleFromMarkdown(markdown),
        threads: [],
        chat: [
          ...state.review.chat,
          {
            id: makeId("chat"),
            author: "human",
            body: `Imported ${file.name}.`,
            createdAt
          }
        ],
        proposals: [],
        contextLedger: [
          createLedgerEvent({
            type: "document_imported",
            actor: "human",
            summary: `Imported Markdown file "${file.name}". Existing threads and proposals were cleared for the new document.`,
            createdAt,
            metadata: {
              words: wordCount(markdown)
            }
          })
        ],
        updatedAt: createdAt
      }
    }));
  }

  async function restoreRevision(revisionId: string) {
    if (!revisionId) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    stateEpochRef.current += 1;
    const restoreEpoch = stateEpochRef.current;

    setIsRestoringRevision(true);
    setSaveState("saving");
    try {
      const restored = await restoreDocumentRevision(revisionId);
      if (restoreEpoch !== stateEpochRef.current) return;
      stateRef.current = restored.document;
      setDocumentState(restored.document);
      setRevisionState(restored.revisions);
      setActiveThreadId(null);
      setSelectionDraft(null);
      setPendingSelectionDraft(null);
      selectionRangeRef.current = null;
      setFloatingToolbar(null);
      window.getSelection()?.removeAllRanges();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      setIsRestoringRevision(false);
    }
  }

  if (!documentState) {
    return (
      <main className="loading-screen">
        <div className="loading-mark" />
        <p>Opening local writing workspace...</p>
      </main>
    );
  }

  const editorLanguage = appSettings.editorLanguage;
  const configuredRuntime = currentConfiguredRuntime();
  const resolvedRuntime =
    agentRuntimeConfig?.resolvedRuntime ?? (configuredRuntime === "auto" ? agentSession?.runtime ?? null : configuredRuntime);
  const configuredModel = currentConfiguredModel();
  const configuredEffort = currentConfiguredEffort();
  const runtimeOptions = agentRuntimeConfig?.runtimes ?? [];
  const providerOptions = runtimeOptions.filter((runtime) => runtime.id !== "stub");
  const providerSelectValue = providerOptions.some((runtime) => runtime.id === configuredRuntime)
    ? configuredRuntime
    : providerOptions.some((runtime) => runtime.id === resolvedRuntime)
      ? resolvedRuntime ?? ""
      : "";
  const selectedRuntimeStatus = runtimeOptions.find((runtime) => runtime.id === resolvedRuntime) ?? null;
  const modelOptions = selectedRuntimeStatus?.models ?? [];
  const effortOptions = selectedRuntimeStatus?.effortLevels ?? [];
  const effortSelectValue = effortOptions.some((level) => level.id === configuredEffort) ? configuredEffort : "auto";
  const agentConfigDisabled = agentSession?.status === "running" || !agentRuntimeConfig;
  const modelControlDisabled =
    agentConfigDisabled || Boolean(selectedRuntimeStatus && !selectedRuntimeStatus.supportsManualModel);
  const effortControlVisible = Boolean(selectedRuntimeStatus?.supportsEffort && effortOptions.length > 0);
  const agentRuntimeTitle = selectedRuntimeStatus
    ? `${selectedRuntimeStatus.label}${selectedRuntimeStatus.version ? ` ${selectedRuntimeStatus.version}` : ""}${
        selectedRuntimeStatus.notes.length > 0 ? `: ${selectedRuntimeStatus.notes.join(" ")}` : ""
      }`
    : "Agent runtime";
  const selectedRuntimeLabel = selectedRuntimeStatus?.label ?? resolvedRuntime ?? "Agent";
  const selectedModelOption = modelOptions.find((model) => model.id === configuredModel);
  const selectedModelLabel = configuredModel === "auto" ? "Default model" : selectedModelOption?.label ?? configuredModel;
  const selectedEffortOption = effortOptions.find((level) => level.id === configuredEffort);
  const selectedEffortLabel =
    configuredEffort === "auto" ? "Default effort" : selectedEffortOption?.label ?? configuredEffort;
  const agentStatusLabel = agentSession
    ? `${agentSession.status}${agentSession.queueDepth > 0 ? ` · ${agentSession.queueDepth}` : ""}`
    : "idle";

  return (
    <main
      className={`app-shell ${isLeftRailCollapsed ? "left-collapsed" : ""} ${
        isRightPanelCollapsed ? "right-collapsed" : ""
      }`}
      data-theme={appSettings.theme}
      data-document-font={appSettings.documentFont}
      lang={editorLanguage}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <img src="/skribe-icon.png?v=2" alt="" />
          </div>
          <div>
            <strong>Skribe</strong>
            <span title={documentState.fileInfo?.displayPath || documentState.fileInfo?.markdownPath}>
              {documentSourceLabel(documentState.fileInfo)}
            </span>
          </div>
        </div>

        <div className="topbar-actions">
          <div className={`agent-config-shell ${isAgentConfigOpen ? "is-open" : ""}`}>
            <button
              type="button"
              className={`agent-config-button is-${agentSession?.status ?? "idle"}`}
              onClick={() => {
                setIsAgentConfigOpen((open) => !open);
                setIsAgentModelMenuOpen(false);
              }}
              title={`${agentRuntimeTitle}. ${selectedModelLabel}. ${selectedEffortLabel}. Status: ${agentStatusLabel}.`}
              aria-expanded={isAgentConfigOpen}
              aria-label="Agent settings"
            >
              <Sparkles size={15} />
              <span>
                <strong>{selectedRuntimeLabel}</strong>
                <small>
                  {selectedModelLabel} · {selectedEffortLabel}
                </small>
              </span>
              <em>{agentStatusLabel}</em>
              <ChevronDown size={14} />
            </button>
            {isAgentConfigOpen ? (
              <div className="agent-config-popover">
                <div className="agent-config-field">
                  <span>Provider</span>
                  <label className="agent-runtime-select-shell" title={agentRuntimeTitle}>
                    <select
                      value={providerSelectValue}
                      onChange={(event) => updateAgentRuntime(event.target.value)}
                      disabled={agentConfigDisabled}
                      aria-label="Agent runtime"
                    >
                      {providerOptions.map((runtime) => (
                        <option key={runtime.id} value={runtime.id} disabled={!runtime.available}>
                          {runtime.label}{runtime.available ? "" : " unavailable"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="agent-config-field">
                  <span>Model</span>
                  <div
                    className="agent-model-shell"
                    title={
                      selectedRuntimeStatus?.supportsManualModel
                        ? "Agent model. Use Default model to let the selected CLI choose."
                        : "Selected runtime does not expose model selection."
                    }
                  >
                    <input
                      value={agentModelDraft}
                      placeholder={configuredModel === "auto" ? "Default model" : configuredModel}
                      disabled={modelControlDisabled}
                      onChange={(event) => setAgentModelDraft(event.target.value)}
                      onFocus={() => setIsAgentModelMenuOpen(true)}
                      onClick={() => setIsAgentModelMenuOpen(true)}
                      onBlur={(event) => {
                        window.setTimeout(() => setIsAgentModelMenuOpen(false), 120);
                        commitAgentModel(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        commitAgentModel(event.currentTarget.value);
                        setIsAgentModelMenuOpen(false);
                        event.currentTarget.blur();
                      }}
                      aria-label="Agent model"
                    />
                    <button
                      type="button"
                      aria-label="Show model options"
                      disabled={modelControlDisabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setIsAgentModelMenuOpen((open) => !open)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    {isAgentModelMenuOpen && !modelControlDisabled ? (
                      <div className="agent-model-menu" role="listbox">
                        <button
                          type="button"
                          className={configuredModel === "auto" ? "is-selected" : ""}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectAgentModel("auto")}
                          role="option"
                          aria-selected={configuredModel === "auto"}
                        >
                          <strong>Default model</strong>
                          <span>{selectedRuntimeStatus?.label || "Selected CLI"} decides</span>
                        </button>
                        {modelOptions.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            className={configuredModel === model.id ? "is-selected" : ""}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectAgentModel(model.id)}
                            role="option"
                            aria-selected={configuredModel === model.id}
                          >
                            <strong>{model.label}</strong>
                            <span>
                              {model.description || (model.label !== model.id ? model.id : model.source || "detected")}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {effortControlVisible ? (
                  <div className="agent-config-field">
                    <span>Effort</span>
                    <label
                      className="agent-effort-select-shell"
                      title={
                        selectedRuntimeStatus?.defaultEffort
                          ? `Reasoning effort. Default: ${selectedRuntimeStatus.defaultEffort}.`
                          : "Reasoning effort. Use Default effort to let the selected CLI choose."
                      }
                    >
                      <select
                        value={effortSelectValue}
                        onChange={(event) => updateAgentEffort(event.target.value)}
                        disabled={agentConfigDisabled}
                        aria-label="Agent reasoning effort"
                      >
                        <option value="auto">Default effort</option>
                        {effortOptions.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <span className={`save-pill is-${saveState}`}>
            {saveState === "saving" ? <RefreshCw size={14} /> : <Save size={14} />}
            {saveState}
          </span>
          <button type="button" className="icon-button" onClick={() => setIsSettingsOpen(true)} title="Settings" aria-label="Settings">
            <Settings size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => fileInputRef.current?.click()}
            title="Import Markdown"
            aria-label="Import Markdown"
          >
            <Upload size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => copyText(documentState.markdown, "Markdown copied")}
            title="Copy Markdown"
            aria-label="Copy Markdown"
          >
            <Copy size={17} />
          </button>
          <button type="button" className="icon-button" onClick={exportMarkdown} title="Export Markdown" aria-label="Export Markdown">
            <Download size={17} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            aria-label="Import Markdown file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importMarkdown(file);
              event.target.value = "";
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            aria-label="Insert image file"
            hidden
            onChange={(event) => {
              const files = event.target.files;
              if (files) void insertImageFiles(files);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          <button type="button"
            className="rail-collapse-button"
            onClick={() => updatePanelState({ leftCollapsed: !isLeftRailCollapsed })}
            title={isLeftRailCollapsed ? "Show left sidebar" : "Hide left sidebar"}
          >
            {isLeftRailCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
          <div className="rail-content">
          <div className="metric-row">
            <div>
              <strong>{words.toLocaleString()}</strong>
              <span>words</span>
            </div>
            <div>
              <strong>{openThreadCount}</strong>
              <span>open</span>
            </div>
          </div>

          <div className="rail-section">
            <div className="rail-heading">
              <FileText size={15} />
              Outline
            </div>
            <nav className="outline-list">
              {outline.length === 0 ? (
                <p className="empty-note">Add Markdown headings to build an outline.</p>
              ) : (
                outline.map((item) => (
                  <a key={item.id} href={`#${item.id}`} className={`outline-item level-${item.level}`}>
                    {item.title}
                  </a>
                ))
              )}
            </nav>
          </div>

          <div className="rail-section rail-section-compact">
            <button type="button"
              className="rail-heading rail-toggle-heading"
              onClick={() => setIsRevisionHistoryOpen((value) => !value)}
              title={isRevisionHistoryOpen ? "Collapse revision history" : "Expand revision history"}
            >
              <span>
                <History size={15} />
                Revisions
              </span>
              <span className="rail-heading-count">{revisionState.revisions.length}</span>
              {isRevisionHistoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <RevisionHistoryPanel
              revisionState={revisionState}
              isOpen={isRevisionHistoryOpen}
              isRestoring={isRestoringRevision}
              onRestore={restoreRevision}
            />
          </div>

          </div>
        </aside>

        <section className="center-pane">
          <div className="canvas-toolbar">
            <div className="format-toolbar" aria-label="Formatting toolbar">
              <button type="button" title="Paragraph (Ctrl/Cmd+Alt+0)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "paragraph", level: undefined }); }}>
                <Pilcrow size={16} />
              </button>
              <button type="button" title="Heading 1 (Ctrl/Cmd+Alt+1)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "heading", level: 1 }); }}>
                <Heading1 size={16} />
              </button>
              <button type="button" title="Heading 2 (Ctrl/Cmd+Alt+2)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "heading", level: 2 }); }}>
                <Heading2 size={16} />
              </button>
              <button type="button" title="Heading 3 (Ctrl/Cmd+Alt+3)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "heading", level: 3 }); }}>
                <Heading3 size={16} />
              </button>
              <span className="toolbar-divider" />
              <button type="button" title="Bold (Ctrl/Cmd+B)" onMouseDown={(event) => { event.preventDefault(); applyInlineCommand("bold"); }}>
                <Bold size={16} />
              </button>
              <button type="button" title="Italic (Ctrl/Cmd+I)" onMouseDown={(event) => { event.preventDefault(); applyInlineCommand("italic"); }}>
                <Italic size={16} />
              </button>
              <button type="button" title="Inline code (Ctrl/Cmd+`)" onMouseDown={(event) => { event.preventDefault(); applyInlineCode(); }}>
                <Code2 size={16} />
              </button>
              <button type="button" title="Insert link (Ctrl/Cmd+K)" onMouseDown={(event) => { event.preventDefault(); openLinkPopover(); }}>
                <LinkIcon size={16} />
              </button>
              <button type="button" title="Insert image" onMouseDown={(event) => { event.preventDefault(); imageInputRef.current?.click(); }}>
                <ImageIcon size={16} />
              </button>
              <span className="toolbar-divider" />
              <button type="button" title="Bulleted list (Ctrl/Cmd+Shift+8)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "unordered-list" }); }}>
                <List size={16} />
              </button>
              <button type="button" title="Numbered list (Ctrl/Cmd+Shift+7)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "ordered-list", marker: "1" }); }}>
                <ListOrdered size={16} />
              </button>
              <button type="button" title="Quote" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "quote" }); }}>
                <Quote size={16} />
              </button>
              <span className="toolbar-divider" />
              <button type="button" title="Comment on selected text" onMouseDown={(event) => { event.preventDefault(); startCommentFromSelection(); }}>
                <MessageSquare size={16} />
              </button>
            </div>
          </div>

          <article
            ref={canvasRef}
            className="markdown-canvas"
            lang={editorLanguage}
            tabIndex={-1}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerCancel}
            onKeyDown={handleCanvasKeyDown}
            onMouseUp={handleCanvasSelectionEvent}
            onKeyUp={handleCanvasSelectionEvent}
            onCopy={handleCanvasCopy}
            onCut={handleCanvasCut}
            onPaste={handleCanvasPaste}
            onDragOver={handleCanvasDragOver}
            onDrop={handleCanvasDrop}
            onContextMenu={handleCanvasContextMenu}
            onScroll={updateFloatingToolbarPosition}
          >
            <InlineProposalReviewBar
              review={activeInlineProposal}
              proposalCount={reviewableProposals.length}
              onProposalStatus={updateProposalStatus}
              onRequestProposalRewrite={requestProposalRewrite}
            />
            <EditableMarkdownCanvas
              markdown={documentState.markdown}
              editorLanguage={editorLanguage}
              threads={threads}
              inlineProposal={activeInlineProposal}
              diffViewMode={appSettings.diffViewMode}
              selectionPreview={selectionDraft ?? pendingSelectionDraft}
              blockResetKeys={blockResetKeys}
              activeBlockId={activeBlockId}
              activeThreadId={activeThread?.id ?? null}
              onActivateThread={(threadId) => {
                activateThread(threadId);
                setPanelMode("threads");
              }}
              onUpdateBlock={updateCanvasBlock}
              onRegisterBlock={registerBlockRef}
              onFocusBlock={focusCanvasBlock}
              onRememberSelection={rememberCanvasSelection}
              onShortcut={handleEditorShortcut}
              onCommitDocument={commitCanvasDom}
              onDocumentInput={scheduleLiveCanvasCommit}
              onMoveBlock={moveCanvasBlock}
              onDeleteBlock={deleteCanvasBlock}
              onProposalChangeDecision={updateProposalChangeDecision}
              onRequestProposalRevision={requestProposalRevision}
              onTableImageExported={notifyTableImageExported}
            />
          </article>
        </section>

        <aside className="right-panel">
          <button type="button"
            className="right-collapse-button"
            onClick={() => updatePanelState({ rightCollapsed: !isRightPanelCollapsed })}
            title={isRightPanelCollapsed ? "Show right sidebar" : "Hide right sidebar"}
          >
            {isRightPanelCollapsed ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
          </button>
          <div className="right-panel-content">
          <div className="panel-tabs">
            <button type="button" className={panelMode === "threads" ? "active" : ""} onClick={() => setPanelMode("threads")}>
              <MessageSquare size={15} />
              Threads
            </button>
            <button type="button" className={panelMode === "chat" ? "active" : ""} onClick={() => setPanelMode("chat")}>
              <Sparkles size={15} />
              Chat
            </button>
          </div>

          {panelMode === "threads" ? (
            <ThreadPanel
              markdown={documentState.markdown}
              threads={visibleThreads}
              activeThread={activeThread}
              activeThreadId={activeThread?.id ?? activeThreadId}
              selectionDraft={selectionDraft}
              newComment={newComment}
              replyDrafts={replyDrafts}
              agentSkills={agentSkills}
              newThreadSkillIds={newThreadSkillIds}
              threadSkillIds={threadSkillIds}
              defaultSkillIds={appSettings.defaultSkills}
              showResolvedThreads={showResolvedThreads}
              resolvedThreadCount={resolvedThreadCount}
              onSetNewComment={setNewComment}
              onSetNewThreadSkillIds={setNewThreadSkillIds}
              onAddThread={addThread}
              onClearSelection={() => {
                setSelectionDraft(null);
                setPendingSelectionDraft(null);
                selectionRangeRef.current = null;
                setFloatingToolbar(null);
                window.getSelection()?.removeAllRanges();
              }}
              onActivateThread={(threadId) => activateThread(threadId, { scroll: true })}
              onSetReplyDrafts={setReplyDrafts}
              onSetThreadSkillIds={setThreadSkillIds}
              onAddMessage={addThreadMessage}
              onRequestAgentReply={requestThreadAgentReply}
              onSetStatus={updateThreadStatus}
              onSuggestionStatus={updateSuggestionStatus}
              onToggleResolvedThreads={() =>
                void persistSettings({
                  ...appSettings,
                  showResolvedThreads: !appSettings.showResolvedThreads
                })
              }
              agentSession={agentSession}
            />
          ) : (
            <ChatPanel
              messages={documentState.review.chat}
              proposals={proposals}
              contextLedger={contextLedger}
              agentSession={agentSession}
              chatDraft={chatDraft}
              agentSkills={agentSkills}
              selectedSkillIds={chatSkillIds}
              diffViewMode={appSettings.diffViewMode}
              onSetChatDraft={setChatDraft}
              onSetSelectedSkillIds={setChatSkillIds}
              onSend={addChatMessage}
              onProposalStatus={updateProposalStatus}
              onProposalChangeDecision={updateProposalChangeDecision}
              onRequestProposalRevision={requestProposalRevision}
            />
          )}
          </div>
        </aside>
      </section>

      {floatingToolbar ? (
        <FloatingFormatToolbar
          position={floatingToolbar}
          activeBlockId={activeBlockId}
          onParagraph={() => updateActiveBlockShape({ type: "paragraph", level: undefined })}
          onHeading={(level) => updateActiveBlockShape({ type: "heading", level })}
          onBold={() => applyInlineCommand("bold")}
          onItalic={() => applyInlineCommand("italic")}
          onInlineCode={applyInlineCode}
          onLink={openLinkPopover}
          onImage={() => imageInputRef.current?.click()}
          onComment={startCommentFromSelection}
        />
      ) : null}

      {linkPopover ? (
        <LinkPopover
          position={linkPopover}
          value={linkDraft}
          inputRef={linkInputRef}
          onChange={setLinkDraft}
          onApply={applyLink}
          onCancel={() => {
            linkRangeRef.current = null;
            linkTargetRef.current = null;
            setLinkPopover(null);
            setLinkDraft("");
          }}
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsDialog
          settings={settingsDraft}
          saveState={settingsSaveState}
          skills={agentSkills}
          runtimeOptions={providerOptions}
          resolvedRuntime={resolvedRuntime}
          onChange={updateSettingsDraft}
          onOpenToneSetup={() => setToneSetupInvocation("settings")}
          onSave={saveSettingsDraft}
          onCancel={() => {
            setSettingsDraft(appSettings);
            setSettingsSaveState("saved");
            setIsSettingsOpen(false);
          }}
        />
      ) : null}

      {toneSetupInvocation ? (
        <ToneSetupDialog
          invocation={toneSetupInvocation}
          currentTone={toneSettingsBase().toneOfVoice}
          editorLanguage={toneSettingsBase().editorLanguage}
          onSave={saveToneOfVoiceSetup}
          onSkip={skipToneOfVoiceSetup}
          onCancel={() => {
            if (toneSetupInvocation === "first-run") {
              skipToneOfVoiceSetup();
            } else {
              setToneSetupInvocation(null);
            }
          }}
        />
      ) : null}

      {selectionContextMenu ? (
        <div
          className="selection-context-menu"
          style={{ left: selectionContextMenu.left, top: selectionContextMenu.top }}
          role="menu"
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!selectionContextMenu.hasSelection}
            onClick={() => {
              setSelectionContextMenu(null);
              void copyActiveSelectionToClipboard();
            }}
          >
            <Copy size={14} />
            Copy
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!selectionContextMenu.hasSelection}
            onClick={() => {
              setSelectionContextMenu(null);
              void cutActiveSelectionToClipboard();
            }}
          >
            <Scissors size={14} />
            Cut
          </button>
          <button type="button" role="menuitem" onClick={() => void pasteClipboardFromMenu(false)}>
            <FileText size={14} />
            Paste
          </button>
          <button type="button" role="menuitem" onClick={() => void pasteClipboardFromMenu(true)}>
            <Pilcrow size={14} />
            Paste Markdown
          </button>
        </div>
      ) : null}

      {lastCopied ? <div className="toast">{lastCopied}</div> : null}
    </main>
  );
}

function toneModeIcon(mode: ToneSetupMode) {
  if (mode === "manual") return <PenLine size={15} />;
  if (mode === "interview") return <MessageSquare size={15} />;
  if (mode === "links") return <Globe size={15} />;
  return <BookOpen size={15} />;
}

function ToneSetupDialog({
  invocation,
  currentTone,
  editorLanguage,
  onSave,
  onSkip,
  onCancel
}: {
  invocation: ToneSetupInvocation;
  currentTone: string;
  editorLanguage: SupportedEditorLanguage;
  onSave: (toneOfVoice: string) => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<ToneSetupMode>(currentTone.trim() ? "manual" : "interview");
  const [manualText, setManualText] = useState(currentTone);
  const [interviewMessages, setInterviewMessages] = useState<ToneInterviewMessage[]>([]);
  const [interviewDraft, setInterviewDraft] = useState("");
  const [interviewState, setInterviewState] = useState<"idle" | "thinking" | "error">("idle");
  const [urls, setUrls] = useState(() => Array.from({ length: 5 }, () => ""));
  const [selectedArchetypeId, setSelectedArchetypeId] = useState(toneArchetypeOptions[0]?.id ?? "direct-founder");
  const [generatedTone, setGeneratedTone] = useState(currentTone);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [builderState, setBuilderState] = useState<"idle" | "generating" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const previewTone = mode === "manual" ? manualText : generatedTone;
  const isBusy = builderState === "generating" || builderState === "saving" || interviewState === "thinking";

  function updateUrl(index: number, value: string) {
    setUrls((currentUrls) => currentUrls.map((url, urlIndex) => (urlIndex === index ? value : url)));
  }

  const requestInterviewTurn = useCallback(async (nextMessages: ToneInterviewMessage[], options: { forceGenerate?: boolean } = {}) => {
    setInterviewState("thinking");
    setErrorMessage("");
    setWarnings([]);
    try {
      const response = await sendToneInterviewMessage({
        messages: nextMessages,
        editorLanguage,
        currentTone: generatedTone || currentTone,
        forceGenerate: options.forceGenerate
      });
      const reply = response.reply.trim();
      const messagesWithReply = reply ? [...nextMessages, { role: "agent" as const, body: reply }] : nextMessages;
      setInterviewMessages(messagesWithReply);
      if (response.toneOfVoice) setGeneratedTone(response.toneOfVoice);
      setWarnings(response.warnings);
      setInterviewState("idle");
      return response;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setInterviewState("error");
      return null;
    }
  }, [currentTone, editorLanguage, generatedTone]);

  useEffect(() => {
    if (mode !== "interview" || interviewMessages.length > 0 || interviewState === "thinking") return;
    void requestInterviewTurn([]);
  }, [interviewMessages.length, interviewState, mode, requestInterviewTurn]);

  async function submitInterviewMessage() {
    const body = interviewDraft.trim();
    if (!body || isBusy) return;
    const nextMessages: ToneInterviewMessage[] = [...interviewMessages, { role: "human", body }];
    setInterviewMessages(nextMessages);
    setInterviewDraft("");
    await requestInterviewTurn(nextMessages);
  }

  function restartInterview() {
    setInterviewMessages([]);
    setInterviewDraft("");
    setGeneratedTone("");
    setWarnings([]);
    setErrorMessage("");
    setInterviewState("idle");
    void requestInterviewTurn([]);
  }

  async function buildTone() {
    if (mode === "interview") {
      if (generatedTone.trim()) return generatedTone;
      setBuilderState("generating");
      const response = await requestInterviewTurn(interviewMessages, { forceGenerate: true });
      setBuilderState(response ? "idle" : "error");
      return response?.toneOfVoice ?? "";
    }

    setBuilderState("generating");
    setErrorMessage("");
    setWarnings([]);
    try {
      const response = await generateToneOfVoice({
        mode,
        manualText,
        urls,
        archetypeId: selectedArchetypeId,
        editorLanguage
      });
      setGeneratedTone(response.toneOfVoice);
      if (mode === "manual") setManualText(response.toneOfVoice);
      setWarnings(response.warnings);
      setBuilderState("idle");
      return response.toneOfVoice;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setBuilderState("error");
      return "";
    }
  }

  async function saveTone() {
    const tone = previewTone.trim() || (await buildTone()).trim();
    if (!tone) return;
    setBuilderState("saving");
    await onSave(tone);
  }

  return (
    <div className="settings-backdrop tone-setup-backdrop" role="presentation" onMouseDown={() => !isBusy && onCancel()}>
      <section
        className="settings-dialog tone-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tone-setup-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <span>{invocation === "first-run" ? "First run" : "Settings"}</span>
            <h2 id="tone-setup-title">Tone of voice</h2>
          </div>
          <button type="button" className="icon-button mini" onClick={onCancel} title="Close tone setup" disabled={isBusy}>
            <X size={15} />
          </button>
        </header>

        <div className="tone-mode-tabs" role="tablist" aria-label="Tone setup mode">
          {toneSetupModes.map((option) => (
            <button
              key={option.id}
              className={mode === option.id ? "is-active" : ""}
              onClick={() => {
                setMode(option.id);
                setErrorMessage("");
                setWarnings([]);
              }}
              type="button"
            >
              {toneModeIcon(option.id)}
              {option.label}
            </button>
          ))}
        </div>

        <div className="tone-setup-body">
          {mode === "manual" ? (
            <label className="settings-field">
              <span>Manual tone</span>
              <textarea
                value={manualText}
                onChange={(event) => setManualText(event.target.value)}
                placeholder="Direct, founder-to-founder, plainspoken, no hype, British English."
                rows={8}
              />
            </label>
          ) : null}

          {mode === "interview" ? (
            <div className="tone-interview-chat">
              <div className="settings-field-header">
                <span>Interview</span>
                <button type="button" className="ghost-button small" onClick={restartInterview} disabled={isBusy}>
                  <RotateCcw size={14} />
                  Start over
                </button>
              </div>
              <div className="tone-interview-messages" aria-live="polite">
                {interviewMessages.map((message, index) => (
                  <article key={`${message.role}-${index}`} className={`tone-interview-message is-${message.role}`}>
                    <strong>{message.role === "agent" ? "Skribe" : "You"}</strong>
                    <p>{message.body}</p>
                  </article>
                ))}
                {interviewState === "thinking" ? <AgentTypingIndicator label="Skribe is thinking" /> : null}
              </div>
              <form
                className="tone-interview-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitInterviewMessage();
                }}
              >
                <textarea
                  value={interviewDraft}
                  aria-label="Tone interview reply"
                  onChange={(event) => setInterviewDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void submitInterviewMessage();
                    }
                  }}
                  placeholder="Reply to Skribe..."
                  rows={4}
                  disabled={isBusy}
                />
                <button className="primary-button" type="submit" disabled={isBusy || !interviewDraft.trim()}>
                  <Send size={15} />
                  Send
                </button>
              </form>
            </div>
          ) : null}

          {mode === "links" ? (
            <div className="tone-link-list">
              {urls.map((url, index) => (
                <label key={index} className="settings-field">
                  <span>Link {index + 1}</span>
                  <input
                    value={url}
                    onChange={(event) => updateUrl(index, event.target.value)}
                    placeholder="https://example.com/post"
                  />
                </label>
              ))}
            </div>
          ) : null}

          {mode === "archetype" ? (
            <div className="tone-archetype-grid">
              {toneArchetypeOptions.map((archetype) => (
                <button
                  key={archetype.id}
                  className={selectedArchetypeId === archetype.id ? "is-selected" : ""}
                  onClick={() => {
                    setSelectedArchetypeId(archetype.id);
                    setGeneratedTone("");
                  }}
                  type="button"
                >
                  <strong>{archetype.label}</strong>
                  <small>{archetype.description}</small>
                </button>
              ))}
            </div>
          ) : null}

          {mode !== "manual" ? (
            <div className="tone-preview">
              <div className="settings-field-header">
                <span>Generated tone</span>
                <button type="button" className="secondary-button small" onClick={buildTone} disabled={isBusy}>
                  <Sparkles size={14} />
                  {builderState === "generating" ? "Generating" : "Generate"}
                </button>
              </div>
              <textarea
                value={generatedTone}
                aria-label="Generated tone of voice"
                onChange={(event) => setGeneratedTone(event.target.value)}
                placeholder="Generate a tone profile, then edit it here."
                rows={6}
              />
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="tone-warning-list">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}

          {errorMessage ? <p className="tone-error">{errorMessage}</p> : null}
        </div>

        <footer className="settings-dialog-actions">
          <span className={`settings-save-state is-${builderState === "error" ? "error" : "saved"}`}>
            {builderState === "generating" || builderState === "saving"
              ? "working"
              : builderState === "error"
                ? "error"
                : "ready"}
          </span>
          {invocation === "first-run" ? (
            <button type="button" className="ghost-button" onClick={onSkip} disabled={isBusy}>
              Skip
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={saveTone} disabled={isBusy}>
            <Save size={15} />
            Save tone
          </button>
        </footer>
      </section>
    </div>
  );
}

function SettingsDialog({
  settings,
  saveState,
  skills,
  runtimeOptions,
  resolvedRuntime,
  onChange,
  onOpenToneSetup,
  onSave,
  onCancel
}: {
  settings: AppSettings;
  saveState: SaveState;
  skills: AgentSkill[];
  runtimeOptions: AgentRuntimeConfig["runtimes"];
  resolvedRuntime: string | null;
  onChange: (patch: Partial<AppSettings>) => void;
  onOpenToneSetup: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("writing");
  const selectedRuntimeId = settings.agentRuntime === "auto" ? resolvedRuntime : settings.agentRuntime;
  const selectedRuntimeStatus = runtimeOptions.find((runtime) => runtime.id === selectedRuntimeId) ?? null;
  const modelOptions = selectedRuntimeStatus?.models ?? [];
  const effortOptions = selectedRuntimeStatus?.effortLevels ?? [];
  const modelSelectValue =
    settings.agentModel === "auto" || modelOptions.some((model) => model.id === settings.agentModel)
      ? settings.agentModel
      : "__custom";
  const effortSelectValue =
    settings.agentEffort === "auto" || effortOptions.some((effort) => effort.id === settings.agentEffort)
      ? settings.agentEffort
      : "auto";
  const selectedDocumentFont = documentFontOptions.find((option) => option.value === settings.documentFont) ?? documentFontOptions[0];
  const selectedTheme = appThemeOptions.find((option) => option.value === settings.theme) ?? appThemeOptions[0];
  const selectedDiffViewMode = diffViewModeOptions.find((option) => option.value === settings.diffViewMode) ?? diffViewModeOptions[0];

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <span>Settings</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button type="button" className="icon-button mini" onClick={onCancel} title="Close settings">
            <X size={15} />
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {settingsTabOptions.map((tab) => (
            <button
              key={tab.id}
              type="button"
              id={`settings-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id={`settings-panel-${activeTab}`}
          className="settings-form settings-tab-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
        >
          {activeTab === "writing" ? (
            <>
              <div className="settings-field">
                <div className="settings-field-header">
                  <span>Tone of voice</span>
                  <button type="button" className="secondary-button small" onClick={onOpenToneSetup}>
                    <Sparkles size={14} />
                    Build tone
                  </button>
                </div>
                <textarea
                  value={settings.toneOfVoice}
                  aria-label="Tone of voice"
                  onChange={(event) => onChange({ toneOfVoice: event.target.value })}
                  placeholder="Direct, plainspoken, founder-to-founder, no hype."
                  rows={5}
                />
              </div>

              <div className="settings-grid">
                <label className="settings-field">
                  <span>Language</span>
                  <select
                    value={settings.editorLanguage}
                    onChange={(event) => onChange({ editorLanguage: event.target.value as SupportedEditorLanguage })}
                  >
                    {editorLanguageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small className="is-placeholder" aria-hidden="true">
                    Language helper
                  </small>
                </label>

                <label className="settings-field">
                  <span>Document font</span>
                  <select
                    value={settings.documentFont}
                    onChange={(event) => onChange({ documentFont: event.target.value as SupportedDocumentFont })}
                  >
                    {documentFontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>{selectedDocumentFont.description}</small>
                </label>
              </div>

              <label className="settings-field">
                <span>Theme</span>
                <select
                  value={settings.theme}
                  onChange={(event) => onChange({ theme: event.target.value as SupportedAppTheme })}
                >
                  {appThemeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>{selectedTheme.description}</small>
              </label>
            </>
          ) : null}

          {activeTab === "agent" ? (
            <>
              <div className="settings-grid">
                <label className="settings-field">
                  <span>Agent provider</span>
                  <select
                    value={settings.agentRuntime}
                    onChange={(event) =>
                      onChange({
                        agentRuntime: event.target.value,
                        agentModel: "auto",
                        agentEffort: "auto"
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    {runtimeOptions.map((runtime) => (
                      <option key={runtime.id} value={runtime.id} disabled={!runtime.available}>
                        {runtime.label}{runtime.available ? "" : " unavailable"}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="settings-field">
                  <span>Agent model</span>
                  <select
                    value={modelSelectValue}
                    disabled={Boolean(selectedRuntimeStatus && !selectedRuntimeStatus.supportsManualModel)}
                    onChange={(event) => {
                      if (event.target.value === "__custom") return;
                      onChange({ agentModel: event.target.value });
                    }}
                  >
                    <option value="auto">Default model</option>
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                    {modelSelectValue === "__custom" ? <option value="__custom">{settings.agentModel}</option> : null}
                  </select>
                </label>
              </div>

              <label className="settings-field">
                <span>Agent effort</span>
                <select
                  value={effortSelectValue}
                  disabled={Boolean(selectedRuntimeStatus && !selectedRuntimeStatus.supportsEffort)}
                  onChange={(event) => onChange({ agentEffort: event.target.value })}
                >
                  <option value="auto">Default effort</option>
                  {effortOptions.map((effort) => (
                    <option key={effort.id} value={effort.id}>
                      {effort.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="settings-field">
                <span>Default skills</span>
                <SettingsSkillPicker
                  skills={skills}
                  selectedSkillIds={settings.defaultSkills}
                  onChange={(defaultSkills) => onChange({ defaultSkills })}
                />
              </div>

              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.autoReplyToComments}
                  onChange={(event) => onChange({ autoReplyToComments: event.target.checked })}
                />
                <span>Auto-reply to new comments</span>
              </label>

              <label className="settings-field">
                <span>Proposal mode</span>
                <select
                  value={settings.proposalModeDefault}
                  onChange={(event) =>
                    onChange({ proposalModeDefault: event.target.value === "bold" ? "bold" : "conservative" })
                  }
                >
                  <option value="conservative">Conservative</option>
                  <option value="bold">Bold</option>
                </select>
              </label>

              <label className="settings-field">
                <span>Diff view</span>
                <select
                  value={settings.diffViewMode}
                  onChange={(event) => onChange({ diffViewMode: event.target.value as SupportedDiffViewMode })}
                >
                  {diffViewModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>{selectedDiffViewMode.description}</small>
              </label>
            </>
          ) : null}

          {activeTab === "workspace" ? (
            <>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.showResolvedThreads}
                  onChange={(event) => onChange({ showResolvedThreads: event.target.checked })}
                />
                <span>Show resolved threads</span>
              </label>

              <div className="settings-grid">
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={settings.panelState.leftCollapsed}
                    onChange={(event) =>
                      onChange({
                        panelState: {
                          ...settings.panelState,
                          leftCollapsed: event.target.checked
                        }
                      })
                    }
                  />
                  <span>Collapse left panel</span>
                </label>

                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={settings.panelState.rightCollapsed}
                    onChange={(event) =>
                      onChange({
                        panelState: {
                          ...settings.panelState,
                          rightCollapsed: event.target.checked
                        }
                      })
                    }
                  />
                  <span>Collapse right panel</span>
                </label>
              </div>
            </>
          ) : null}
        </div>

        <footer className="settings-dialog-actions">
          <span className={`settings-save-state is-${saveState}`}>{saveState}</span>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onSave} disabled={saveState === "saving"}>
            <Save size={15} />
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

function SettingsSkillPicker({
  skills,
  selectedSkillIds,
  onChange
}: {
  skills: AgentSkill[];
  selectedSkillIds: string[];
  onChange: (skillIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSkills = selectedSkillIds
    .map((id) => skills.find((skill) => skill.id === id) ?? { id, name: id, description: "", source: "saved" })
    .filter(Boolean) as AgentSkill[];
  const filteredSkills = skills.filter((skill) => skillMatchesQuery(skill, query)).slice(0, 20);

  function removeSkill(skillId: string) {
    onChange(selectedSkillIds.filter((id) => id !== skillId));
  }

  function toggleSkill(skillId: string) {
    onChange(
      selectedSkillIds.includes(skillId)
        ? selectedSkillIds.filter((id) => id !== skillId)
        : uniqueSkillIds([...selectedSkillIds, skillId])
    );
  }

  return (
    <div className="settings-skill-picker">
      {selectedSkills.length > 0 ? (
        <div className="skill-chip-row" aria-label="Default agent skills">
          {selectedSkills.map((skill) => (
            <button type="button" key={skill.id} className="skill-chip" onClick={() => removeSkill(skill.id)} title={`Remove ${skillLabel(skill)}`}>
              /{skill.id}
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}

      <label className="skill-search settings-skill-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" />
      </label>

      <div className="settings-skill-list">
        {filteredSkills.length === 0 ? (
          <p className="empty-note">No skills match that search.</p>
        ) : (
          filteredSkills.map((skill) => {
            const selected = selectedSkillIds.includes(skill.id);
            return (
              <button type="button" key={skill.id} className={selected ? "is-selected" : ""} onClick={() => toggleSkill(skill.id)}>
                <span>
                  <strong>/{skill.id}</strong>
                  <small>{skill.description || skill.source}</small>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatRevisionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function RevisionHistoryPanel({
  revisionState,
  isOpen,
  isRestoring,
  onRestore
}: {
  revisionState: RevisionState;
  isOpen: boolean;
  isRestoring: boolean;
  onRestore: (revisionId: string) => void;
}) {
  const revisions = revisionState.revisions.slice(0, 14);
  const currentRevision =
    revisionState.revisions.find((revision) => revision.id === revisionState.currentRevisionId) ?? revisionState.revisions[0] ?? null;

  if (revisions.length === 0) {
    return <p className="empty-note">Revision snapshots appear after the first save.</p>;
  }

  return (
    <>
      <div className="doc-revision-summary">
        <span>{revisions.length} saved</span>
        {currentRevision ? <time>Current {formatRevisionTime(currentRevision.createdAt)}</time> : null}
      </div>
      {isOpen ? (
        <ol className="doc-revision-list">
          {revisions.map((revision) => {
            const isCurrent = revision.id === revisionState.currentRevisionId;
            return (
              <li key={revision.id} className={`doc-revision-item ${isCurrent ? "is-current" : ""}`}>
                <span className="doc-revision-dot" />
                <div className="doc-revision-main" title={`${revision.reason}: ${revision.title}`}>
                  <time>{formatRevisionTime(revision.createdAt)}</time>
                  <strong>{revision.reason}</strong>
                  <small>{revision.words.toLocaleString()} words · {revision.hash.slice(0, 7)}</small>
                </div>
                {isCurrent ? (
                  <span className="doc-revision-current">Current</span>
                ) : (
                  <button type="button"
                    className="secondary-button small doc-revision-restore"
                    disabled={isRestoring}
                    onClick={() => onRestore(revision.id)}
                    title="Restore this document revision"
                  >
                    <RotateCcw size={12} />
                    Restore
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </>
  );
}

function MessageSkillChips({ skills }: { skills?: AgentSkillSelection[] }) {
  if (!skills || skills.length === 0) return null;
  return (
    <div className="message-skill-row">
      {skills.map((skill) => (
        <span key={skill.id}>/{skill.id}</span>
      ))}
    </div>
  );
}

function SkillComposer({
  value,
  onChange,
  selectedSkillIds,
  onSelectedSkillIdsChange,
  skills,
  placeholder,
  ariaLabel,
  rows,
  submitLabel,
  submitIcon,
  onSubmit
}: {
  value: string;
  onChange: (value: string) => void;
  selectedSkillIds: string[];
  onSelectedSkillIdsChange: (skillIds: string[]) => void;
  skills: AgentSkill[];
  placeholder: string;
  ariaLabel: string;
  rows: number;
  submitLabel: string;
  submitIcon: React.ReactNode;
  onSubmit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const slashCommand = getActiveSlashCommand(value, cursor);
  const query = slashCommand?.query ?? "";
  const selectedSkills = selectedSkillIds
    .map((id) => skills.find((skill) => skill.id === id))
    .filter(Boolean) as AgentSkill[];
  const matchingSkills = slashCommand ? skills.filter((skill) => skillMatchesQuery(skill, query)).slice(0, 7) : [];
  const showBrowseOption = slashCommand && "skills".startsWith(query.toLowerCase());
  const autocompleteOptions = [
    ...(showBrowseOption ? [{ kind: "browse" as const, id: "__skills", label: "/skills", description: "Browse every available skill" }] : []),
    ...matchingSkills.map((skill) => ({ kind: "skill" as const, skill }))
  ];
  const filteredPickerSkills = skills.filter((skill) => skillMatchesQuery(skill, skillSearch)).slice(0, 80);

  function updateCursor(node: HTMLTextAreaElement) {
    setCursor(node.selectionStart ?? node.value.length);
  }

  function removeSlashCommand() {
    if (!slashCommand) return;
    const nextValue = `${value.slice(0, slashCommand.start)}${value.slice(slashCommand.end)}`.replace(/[ \t]{2,}/g, " ");
    onChange(nextValue);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(slashCommand.start, slashCommand.start);
      setCursor(slashCommand.start);
    });
  }

  function addSkill(skill: AgentSkill) {
    onSelectedSkillIdsChange(uniqueSkillIds([...selectedSkillIds, skill.id]));
    removeSlashCommand();
    setActiveIndex(0);
  }

  function removeSkill(skillId: string) {
    onSelectedSkillIdsChange(selectedSkillIds.filter((id) => id !== skillId));
  }

  function openSkillsPicker() {
    setIsPickerOpen(true);
    removeSlashCommand();
  }

  function chooseAutocomplete(index: number) {
    const option = autocompleteOptions[index];
    if (!option) return;
    if (option.kind === "browse") openSkillsPicker();
    else addSkill(option.skill);
  }

  return (
    <div className="skill-composer">
      {selectedSkills.length > 0 ? (
        <div className="skill-chip-row" aria-label="Selected agent skills">
          {selectedSkills.map((skill) => (
            <button type="button" key={skill.id} className="skill-chip" onClick={() => removeSkill(skill.id)} title={`Remove ${skillLabel(skill)}`}>
              /{skill.id}
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}

      <div className="skill-textarea-shell">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            updateCursor(event.target);
            setActiveIndex(0);
          }}
          onClick={(event) => updateCursor(event.currentTarget)}
          onKeyUp={(event) => updateCursor(event.currentTarget)}
          onKeyDown={(event) => {
            if (autocompleteOptions.length > 0 && slashCommand) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % autocompleteOptions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + autocompleteOptions.length) % autocompleteOptions.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                chooseAutocomplete(activeIndex);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setCursor(0);
                return;
              }
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          rows={rows}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />

        {autocompleteOptions.length > 0 && slashCommand ? (
          <div className="skill-autocomplete" role="listbox">
            {autocompleteOptions.map((option, index) =>
              option.kind === "browse" ? (
                <button type="button"
                  key={option.id}
                  className={index === activeIndex ? "is-active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openSkillsPicker}
                >
                  <Sparkles size={14} />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </button>
              ) : (
                <button type="button"
                  key={option.skill.id}
                  className={index === activeIndex ? "is-active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addSkill(option.skill)}
                >
                  <Sparkles size={14} />
                  <span>
                    <strong>/{option.skill.id}</strong>
                    <small>{option.skill.description || option.skill.source}</small>
                  </span>
                </button>
              )
            )}
          </div>
        ) : null}
      </div>

      {isPickerOpen ? (
        <div className="skill-picker-panel">
          <div className="skill-picker-header">
            <strong>Agent skills</strong>
            <span>{skills.length}</span>
            <button type="button" className="icon-button mini" onClick={() => setIsPickerOpen(false)} title="Close skills">
              <X size={12} />
            </button>
          </div>
          <label className="skill-search">
            <Search size={14} />
            <input
              value={skillSearch}
              onChange={(event) => setSkillSearch(event.target.value)}
              placeholder="Search skills"
              aria-label="Search skills"
            />
          </label>
          <div className="skill-picker-list">
            {filteredPickerSkills.length === 0 ? (
              <p className="empty-note">No skills match that search.</p>
            ) : (
              filteredPickerSkills.map((skill) => {
                const selected = selectedSkillIds.includes(skill.id);
                return (
                  <button type="button"
                    key={skill.id}
                    className={selected ? "is-selected" : ""}
                    onClick={() => (selected ? removeSkill(skill.id) : onSelectedSkillIdsChange(uniqueSkillIds([...selectedSkillIds, skill.id])))}
                  >
                    <span>
                      <strong>/{skill.id}</strong>
                      <small>{skill.description || skill.source}</small>
                    </span>
                    <em>{skill.source}</em>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      <div className="skill-composer-actions">
        <button type="button" className="secondary-button small" onClick={() => setIsPickerOpen((open) => !open)} title="Browse agent skills">
          <Sparkles size={14} />
          Skills
        </button>
        <button type="button" className="primary-button" onClick={onSubmit}>
          {submitIcon}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface MarkdownCanvasProps {
  markdown: string;
  editorLanguage: SupportedEditorLanguage;
  threads: ReviewThread[];
  inlineProposal: InlineProposalReview | null;
  diffViewMode: SupportedDiffViewMode;
  selectionPreview: SelectionDraft | null;
  blockResetKeys: Record<string, number>;
  activeBlockId: string | null;
  activeThreadId: string | null;
  onActivateThread: (threadId: string) => void;
  onUpdateBlock: (blockId: string, text: string) => void;
  onRegisterBlock: (blockId: string, node: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
  onRememberSelection: () => void;
  onShortcut: (event: React.KeyboardEvent<HTMLElement>, blockId: string) => void;
  onCommitDocument: () => void;
  onDocumentInput: () => void;
  onMoveBlock: (blockId: string, targetBlockId: string, placement: BlockDropPlacement) => void;
  onDeleteBlock: (blockId: string) => void;
  onProposalChangeDecision: (proposalId: string, changeKey: string, decision: ProposalChangeDecision) => void;
  onRequestProposalRevision: (proposalId: string, change: ProposalChangeBlock, instruction: string) => void;
  onTableImageExported: (status: "success" | "error") => void;
}

function FloatingFormatToolbar({
  position,
  activeBlockId,
  onParagraph,
  onHeading,
  onBold,
  onItalic,
  onInlineCode,
  onLink,
  onImage,
  onComment
}: {
  position: FloatingToolbarState;
  activeBlockId: string | null;
  onParagraph: () => void;
  onHeading: (level: 1 | 2 | 3) => void;
  onBold: () => void;
  onItalic: () => void;
  onInlineCode: () => void;
  onLink: () => void;
  onImage: () => void;
  onComment: () => void;
}) {
  const keepSelection = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div
      className={`floating-format-toolbar is-${position.placement}`}
      style={{ left: position.left, top: position.top }}
      role="toolbar"
      aria-label="Selection formatting toolbar"
    >
      <button type="button" title="Paragraph" disabled={!activeBlockId} onMouseDown={keepSelection} onClick={onParagraph}>
        <Pilcrow size={15} />
      </button>
      <button type="button" title="Heading 1" disabled={!activeBlockId} onMouseDown={keepSelection} onClick={() => onHeading(1)}>
        <Heading1 size={15} />
      </button>
      <button type="button" title="Heading 2" disabled={!activeBlockId} onMouseDown={keepSelection} onClick={() => onHeading(2)}>
        <Heading2 size={15} />
      </button>
      <button type="button" title="Heading 3" disabled={!activeBlockId} onMouseDown={keepSelection} onClick={() => onHeading(3)}>
        <Heading3 size={15} />
      </button>
      <span className="toolbar-divider" />
      <button type="button" title="Bold" onMouseDown={keepSelection} onClick={onBold}>
        <Bold size={15} />
      </button>
      <button type="button" title="Italic" onMouseDown={keepSelection} onClick={onItalic}>
        <Italic size={15} />
      </button>
      <button type="button" title="Inline code" onMouseDown={keepSelection} onClick={onInlineCode}>
        <Code2 size={15} />
      </button>
      <button type="button" title="Insert link" onMouseDown={keepSelection} onClick={onLink}>
        <LinkIcon size={15} />
      </button>
      <button type="button" title="Insert image" onMouseDown={keepSelection} onClick={onImage}>
        <ImageIcon size={15} />
      </button>
      <span className="toolbar-divider" />
      <button type="button" title="Comment on selected text" onMouseDown={keepSelection} onClick={onComment}>
        <MessageSquare size={15} />
      </button>
    </div>
  );
}

function LinkPopover({
  position,
  value,
  inputRef,
  onChange,
  onApply,
  onCancel
}: {
  position: LinkPopoverState;
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="link-popover" style={{ left: position.left, top: position.top }} role="dialog" aria-label="Insert link">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onApply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder="https://example.com"
        aria-label="Link URL"
      />
      <button
        type="button"
        className="primary-button small"
        onMouseDown={(event) => {
          event.preventDefault();
          onApply();
        }}
        disabled={!value.trim()}
      >
        Apply
      </button>
      <button
        type="button"
        className="ghost-button small"
        onMouseDown={(event) => {
          event.preventDefault();
          onCancel();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function EditableMarkdownCanvas({
  markdown,
  editorLanguage,
  threads,
  inlineProposal,
  diffViewMode,
  selectionPreview,
  blockResetKeys,
  activeBlockId,
  activeThreadId,
  onActivateThread,
  onUpdateBlock,
  onRegisterBlock,
  onFocusBlock,
  onRememberSelection,
  onShortcut,
  onCommitDocument,
  onDocumentInput,
  onMoveBlock,
  onDeleteBlock,
  onProposalChangeDecision,
  onRequestProposalRevision,
  onTableImageExported
}: MarkdownCanvasProps) {
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ blockId: string; placement: BlockDropPlacement } | null>(null);
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);
  const visibleBlocks = useMemo(
    () => (blocks.length > 0 ? blocks : [{ id: markdownBlockIdFromIndex(0), type: "paragraph" as const, text: "" }]),
    [blocks]
  );
  const blockSpans = useMemo(() => getMarkdownBlockLineSpans(markdown), [markdown]);
  const selectionPreviewThread = useMemo<ReviewThread | null>(
    () =>
      selectionPreview
        ? {
            id: "selection-preview",
            status: "open",
            anchor: selectionPreview,
            messages: [],
            suggestions: [],
            createdAt: "",
            updatedAt: ""
          }
        : null,
    [selectionPreview]
  );
  const canvasThreads = useMemo(
    () => (selectionPreviewThread ? [...threads, selectionPreviewThread] : threads),
    [threads, selectionPreviewThread]
  );
  const canvasActiveThreadId = selectionPreviewThread?.id ?? activeThreadId;
  const inlineChangesByBlock = useMemo(() => {
    const byBlock = new Map<string, InlineProposalChange[]>();
    inlineProposal?.changes.forEach((change) => {
      if (change.decision) return;
      if (!change.anchorBlockId) return;
      const existing = byBlock.get(change.anchorBlockId) ?? [];
      existing.push(change);
      byBlock.set(change.anchorBlockId, existing);
    });
    return byBlock;
  }, [inlineProposal]);
  const unanchoredInlineChanges = useMemo(
    () => inlineProposal?.changes.filter((change) => !change.anchorBlockId && !change.decision) ?? [],
    [inlineProposal]
  );

  function clearBlockDragState() {
    setDraggingBlockId(null);
    setDropTarget(null);
  }

  function updateDropTarget(event: React.DragEvent<HTMLElement>, targetBlockId: string) {
    if (!draggingBlockId || draggingBlockId === targetBlockId) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const placement: BlockDropPlacement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) =>
      current?.blockId === targetBlockId && current.placement === placement ? current : { blockId: targetBlockId, placement }
    );
  }

  function dropBlock(event: React.DragEvent<HTMLElement>, targetBlockId: string) {
    if (!draggingBlockId || draggingBlockId === targetBlockId || !dropTarget) return;

    event.preventDefault();
    onMoveBlock(draggingBlockId, targetBlockId, dropTarget.placement);
    clearBlockDragState();
  }

  function currentBlockIdFromSelection() {
    const selection = window.getSelection();
    const node = selection?.focusNode ?? selection?.anchorNode;
    return node ? closestEditableBlock(node)?.dataset.blockId ?? null : null;
  }

  function focusCurrentSelectionBlock(target?: EventTarget | null) {
    const targetBlock =
      target instanceof Node ? closestEditableBlock(target)?.dataset.blockId ?? null : currentBlockIdFromSelection();
    const blockId = targetBlock ?? currentBlockIdFromSelection();
    if (blockId) onFocusBlock(blockId);
    return blockId;
  }

  function handleDocumentKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const blockId = currentBlockIdFromSelection();
    if (blockId) onShortcut(event, blockId);
  }

  function handleDocumentKeyUp(event: React.KeyboardEvent<HTMLElement>) {
    focusCurrentSelectionBlock(event.target);
    onRememberSelection();
  }

  function handleDocumentMouseUp(event: React.MouseEvent<HTMLElement>) {
    focusCurrentSelectionBlock(event.target);
    onRememberSelection();
  }

  function handleDocumentBlur(event: React.FocusEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onCommitDocument();
  }

  function handleDocumentInput() {
    onDocumentInput();
  }

  return (
    <>
      {unanchoredInlineChanges.map((change) => (
        <InlineProposalChangeCard
          key={`${change.proposalId}:${change.key}`}
          change={change}
          diffViewMode={diffViewMode}
          onProposalChangeDecision={onProposalChangeDecision}
          onRequestProposalRevision={onRequestProposalRevision}
        />
      ))}
      <div
        className="editable-document"
        lang={editorLanguage}
        onBlur={handleDocumentBlur}
        onInput={handleDocumentInput}
        onKeyDown={handleDocumentKeyDown}
        onKeyUp={handleDocumentKeyUp}
        onMouseUp={handleDocumentMouseUp}
      >
        {visibleBlocks.map((block) => {
          const blockSpan = blockSpans.find((span) => span.id === block.id) ?? null;
          const blockAnchorRanges =
            blockSpan === null
              ? []
              : canvasThreads
                  .filter(
                    (thread) =>
                      (thread.status === "open" || thread.id === canvasActiveThreadId) &&
                      thread.anchor.kind === "markdown-range" &&
                      thread.anchor.end > blockSpan.textStart &&
                      thread.anchor.start < blockSpan.textEnd
                  )
                  .map((thread) => ({
                    thread,
                    start: clamp(thread.anchor.start - blockSpan.textStart, 0, block.text.length),
                    end: clamp(thread.anchor.end - blockSpan.textStart, 0, block.text.length)
                  }))
                  .filter((range) => range.end > range.start);

          return (
            <React.Fragment key={block.id}>
              <EditableBlockShell
                blockId={block.id}
                isActive={activeBlockId === block.id}
                isDragging={draggingBlockId === block.id}
                dropPlacement={dropTarget?.blockId === block.id ? dropTarget.placement : null}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", block.id);
                  setDraggingBlockId(block.id);
                }}
                onDragOver={(event) => updateDropTarget(event, block.id)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropTarget((current) => (current?.blockId === block.id ? null : current));
                  }
                }}
                onDrop={(event) => dropBlock(event, block.id)}
                onDragEnd={clearBlockDragState}
                onDelete={() => onDeleteBlock(block.id)}
                showControls={blocks.length > 0}
              >
                <EditableBlock
                  key={`${block.id}:${blockResetKeys[block.id] ?? 0}`}
                  block={block}
                  anchorRanges={blockAnchorRanges}
                  editorLanguage={editorLanguage}
                  threads={canvasThreads}
                  activeThreadId={canvasActiveThreadId}
                  onActivateThread={onActivateThread}
                  onUpdateBlock={onUpdateBlock}
                  onRegisterBlock={onRegisterBlock}
                  onFocusBlock={onFocusBlock}
                  onRememberSelection={onRememberSelection}
                  onShortcut={onShortcut}
                  onTableImageExported={onTableImageExported}
                />
              </EditableBlockShell>
              {(inlineChangesByBlock.get(block.id) ?? []).map((change) => (
                <InlineProposalChangeCard
                  key={`${change.proposalId}:${change.key}`}
                  change={change}
                  diffViewMode={diffViewMode}
                  onProposalChangeDecision={onProposalChangeDecision}
                  onRequestProposalRevision={onRequestProposalRevision}
                />
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}

function EditableBlockShell({
  blockId,
  isActive,
  isDragging,
  dropPlacement,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onDelete,
  showControls,
  children
}: {
  blockId: string;
  isActive: boolean;
  isDragging: boolean;
  dropPlacement: BlockDropPlacement | null;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDelete: () => void;
  showControls?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`editable-block-shell ${isActive ? "is-active" : ""} ${isDragging ? "is-dragging" : ""} ${
        dropPlacement ? `is-drop-${dropPlacement}` : ""
      }`}
      data-block-shell={blockId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {showControls === false ? null : (
        <div className="editable-block-controls" aria-label="Block controls" contentEditable={false}>
          <button
            type="button"
            className="block-delete-button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onDelete}
            title="Delete block"
            aria-label="Delete block"
          >
            <X size={13} />
          </button>
          <button
            type="button"
            className="block-drag-handle"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Drag to move block"
            aria-label="Drag to move block"
          >
            <GripVertical size={14} />
          </button>
        </div>
      )}
      <div className="editable-block-content">{children}</div>
    </div>
  );
}

interface EditableBlockProps {
  block: ReturnType<typeof parseMarkdownBlocks>[number];
  anchorRanges: BlockAnchorRange[];
  editorLanguage: SupportedEditorLanguage;
  threads: ReviewThread[];
  activeThreadId: string | null;
  onActivateThread: (threadId: string) => void;
  onUpdateBlock: (blockId: string, text: string) => void;
  onRegisterBlock: (blockId: string, node: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
  onRememberSelection: () => void;
  onShortcut: (event: React.KeyboardEvent<HTMLElement>, blockId: string) => void;
  onTableImageExported: (status: "success" | "error") => void;
}

const EditableBlock = React.memo(function EditableBlock({
  block,
  anchorRanges,
  editorLanguage,
  threads,
  activeThreadId,
  onActivateThread,
  onUpdateBlock,
  onRegisterBlock,
  onFocusBlock,
  onRememberSelection,
  onShortcut,
  onTableImageExported
}: EditableBlockProps) {
  const editableRef = useRef<HTMLElement | null>(null);

  const editableProps: any = {
    ref: (node: HTMLElement | null) => {
      editableRef.current = node;
      onRegisterBlock(block.id, node);
    },
    "data-block-id": block.id,
    onMouseUp: () => {
      onRememberSelection();
      onFocusBlock(block.id);
    },
    onKeyUp: () => {
      onRememberSelection();
      onFocusBlock(block.id);
    },
    onSelect: onRememberSelection,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => onShortcut(event, block.id),
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: true,
    lang: editorLanguage,
    "data-placeholder": "Start writing...",
    className: "editable-text"
  };

  const children = renderHighlightedText(block.text, threads, activeThreadId, onActivateThread, anchorRanges);

  if (block.type === "heading") {
    const tag = `h${Math.min(block.level ?? 2, 3)}` as "h1" | "h2" | "h3";
    return React.createElement(
      tag,
      {
        ...editableProps,
        id: block.id,
        className: `editable-text editable-heading level-${block.level ?? 2}`
      },
      children
    );
  }

  if (block.type === "ordered-list" || block.type === "unordered-list") {
    return (
      <div className={`editable-list-row ${block.type}`}>
        <span className="editable-list-marker">{block.type === "ordered-list" ? `${block.marker ?? "1"}.` : "-"}</span>
        <div {...editableProps}>{children}</div>
      </div>
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote className="editable-quote">
        <div {...editableProps}>{children}</div>
      </blockquote>
    );
  }

  if (block.type === "code") {
    return (
      <pre className="editable-code">
        <code {...editableProps}>{block.text}</code>
      </pre>
    );
  }

  if (block.type === "image") {
    return <EditableImageBlock block={block} onRegisterBlock={onRegisterBlock} onFocusBlock={onFocusBlock} />;
  }

  if (block.type === "table") {
    return <EditableTableBlock block={block} editableProps={editableProps} onTableImageExported={onTableImageExported} />;
  }

  return (
    <p {...editableProps} id={block.id}>
      {children}
    </p>
  );
}, areEditableBlockPropsEqual);

function EditableImageBlock({
  block,
  onRegisterBlock,
  onFocusBlock
}: {
  block: ReturnType<typeof parseMarkdownBlocks>[number];
  onRegisterBlock: (blockId: string, node: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
}) {
  const image = parseMarkdownImage(block.text);
  if (!image) {
    return (
      <p
        data-block-id={block.id}
        className="editable-text"
        contentEditable
        suppressContentEditableWarning
        ref={(node) => onRegisterBlock(block.id, node)}
      >
        {block.text}
      </p>
    );
  }

  return (
    <figure
      id={block.id}
      data-block-id={block.id}
      className="editable-image-block"
      contentEditable={false}
      tabIndex={0}
      ref={(node) => onRegisterBlock(block.id, node)}
      onClick={() => onFocusBlock(block.id)}
      onFocus={() => onFocusBlock(block.id)}
    >
      <div className="editable-image-frame">
        <img src={imagePreviewSrc(image.src)} alt={image.alt} title={image.title} loading="lazy" />
      </div>
      <figcaption>
        <span>{image.alt || imageDisplayName(image.src)}</span>
        <small>{image.src}</small>
      </figcaption>
    </figure>
  );
}

function EditableTableBlock({
  block,
  editableProps,
  onTableImageExported
}: {
  block: ReturnType<typeof parseMarkdownBlocks>[number];
  editableProps: React.HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void; "data-block-id": string };
  onTableImageExported: (status: "success" | "error") => void;
}) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const table = parseMarkdownTable(block.text);
  if (!table) {
    return (
      <p {...editableProps} id={block.id}>
        <span>{block.text}</span>
      </p>
    );
  }

  const columnCount = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 2);
  const headers = Array.from({ length: columnCount }, (_, index) => table.headers[index] ?? "");
  const rows = table.rows.length > 0 ? table.rows : [Array.from({ length: columnCount }, () => "")];
  const cellStyle = (index: number): React.CSSProperties => {
    const textAlign = table.alignments[index];
    return textAlign ? { textAlign: textAlign as React.CSSProperties["textAlign"] } : {};
  };
  const registerTable = (node: HTMLTableElement | null) => {
    tableRef.current = node;
    editableProps.ref(node);
  };
  const exportTableImage = async () => {
    if (!tableRef.current) return;
    try {
      await downloadTableAsPng(tableRef.current, `skribe-table-${block.id}`);
      onTableImageExported("success");
    } catch (error) {
      console.error("Unable to download table image", error);
      onTableImageExported("error");
    }
  };

  return (
    <div className="editable-table-shell">
      <button
        type="button"
        className="table-image-download"
        contentEditable={false}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void exportTableImage();
        }}
        title="Download table as image"
        aria-label="Download table as image"
      >
        <Download size={14} />
      </button>
      <table {...editableProps} ref={registerTable} id={block.id} className="editable-text editable-table">
        <thead>
          <tr>
            {headers.map((cell, index) => (
              <th key={`header-${index}`} style={cellStyle(index)}>
                <InlineMarkdown markdown={cell} keyPrefix={`header-${index}`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {Array.from({ length: columnCount }, (_, index) => (
                <td key={`cell-${rowIndex}-${index}`} style={cellStyle(index)}>
                  <InlineMarkdown markdown={row[index] ?? ""} keyPrefix={`cell-${rowIndex}-${index}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function areEditableBlockPropsEqual(previous: EditableBlockProps, next: EditableBlockProps) {
  return (
    previous.activeThreadId === next.activeThreadId &&
    previous.editorLanguage === next.editorLanguage &&
    anchorRangesRenderKey(previous.anchorRanges) === anchorRangesRenderKey(next.anchorRanges) &&
    previous.block.id === next.block.id &&
    previous.block.type === next.block.type &&
    previous.block.text === next.block.text &&
    previous.block.level === next.block.level &&
    previous.block.marker === next.block.marker &&
    previous.block.language === next.block.language &&
    previous.onTableImageExported === next.onTableImageExported &&
    threadsRenderKey(previous.threads) === threadsRenderKey(next.threads)
  );
}

function anchorRangesRenderKey(ranges: BlockAnchorRange[]) {
  return ranges.map((range) => `${range.thread.id}:${range.start}:${range.end}`).join("|");
}

function threadsRenderKey(threads: ReviewThread[]) {
  return threads
    .map((thread) =>
      [
        thread.id,
        thread.status,
        thread.anchor.exact,
        thread.anchor.kind ?? "",
        thread.anchor.start,
        thread.anchor.end,
        thread.suggestions.map((suggestion) => `${suggestion.id}:${suggestion.status}:${suggestion.replacement}`).join("~")
      ].join(":")
    )
    .join("|");
}

function renderHighlightedText(
  text: string,
  threads: ReviewThread[],
  activeThreadId: string | null,
  onActivateThread: (threadId: string) => void,
  anchorRanges: BlockAnchorRange[] = []
) {
  const exactRanges = threads
    .filter(
      (thread) =>
        thread.anchor.kind !== "markdown-range" &&
        (thread.status === "open" || thread.id === activeThreadId) &&
        thread.anchor.exact
    )
    .map((thread) => {
      const match = findThreadAnchorInText(thread, text);
      return match
        ? {
            thread,
            start: match.start,
            end: match.end
          }
        : null;
    })
    .filter(Boolean) as Array<{ thread: ReviewThread; start: number; end: number }>;
  const ranges = [...anchorRanges, ...exactRanges]
    .sort((a, b) => a!.start - b!.start) as Array<{ thread: ReviewThread; start: number; end: number }>;

  if (ranges.length === 0) {
    if (!text) return null;
    return (
      <span>
        <InlineMarkdown markdown={text} />
      </span>
    );
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start < cursor) return;
    if (range.start > cursor) {
      nodes.push(
        <span key={`segment-${cursor}`}>
          <InlineMarkdown markdown={text.slice(cursor, range.start)} keyPrefix={`segment-${cursor}`} />
        </span>
      );
    }
    const isActive = activeThreadId === range.thread.id;
    nodes.push(
      <span
        key={range.thread.id}
        data-thread-id={range.thread.id}
        className={`anchor-highlight ${isActive ? "is-active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (range.thread.id === "selection-preview") return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          onActivateThread(range.thread.id);
        }}
        onKeyDown={(event) => {
          if (range.thread.id === "selection-preview") return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onActivateThread(range.thread.id);
        }}
      >
        <InlineMarkdown markdown={text.slice(range.start, range.end)} keyPrefix={`range-${range.thread.id}`} />
      </span>
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    nodes.push(
      <span key={`segment-${cursor}`}>
        <InlineMarkdown markdown={text.slice(cursor)} keyPrefix={`segment-${cursor}`} />
      </span>
    );
  }
  return nodes;
}

interface ThreadPanelProps {
  markdown: string;
  threads: ReviewThread[];
  activeThread: ReviewThread | null;
  activeThreadId: string | null;
  selectionDraft: SelectionDraft | null;
  newComment: string;
  replyDrafts: Record<string, string>;
  agentSkills: AgentSkill[];
  newThreadSkillIds: string[];
  threadSkillIds: Record<string, string[]>;
  defaultSkillIds: string[];
  showResolvedThreads: boolean;
  resolvedThreadCount: number;
  onSetNewComment: (value: string) => void;
  onSetNewThreadSkillIds: (value: string[]) => void;
  onAddThread: () => void;
  onClearSelection: () => void;
  onActivateThread: (threadId: string) => void;
  onSetReplyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSetThreadSkillIds: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  onAddMessage: (threadId: string) => void;
  onRequestAgentReply: (threadId: string) => void;
  onSetStatus: (threadId: string, status: "open" | "resolved") => void;
  onSuggestionStatus: (threadId: string, suggestionId: string, status: "accepted" | "rejected") => void;
  onToggleResolvedThreads: () => void;
  agentSession?: AgentSession;
}

function ThreadPanel(props: ThreadPanelProps) {
  const {
    threads,
    markdown,
    activeThread,
    activeThreadId,
    selectionDraft,
    newComment,
    replyDrafts,
    agentSkills,
    newThreadSkillIds,
    threadSkillIds,
    defaultSkillIds,
    showResolvedThreads,
    resolvedThreadCount,
    onSetNewComment,
    onSetNewThreadSkillIds,
    onAddThread,
    onClearSelection,
    onActivateThread,
    onSetReplyDrafts,
    onSetThreadSkillIds,
    onAddMessage,
    onRequestAgentReply,
    onSetStatus,
    onSuggestionStatus,
    onToggleResolvedThreads,
    agentSession
  } = props;
  const workingThreadId = agentSession?.activeTurn?.source === "thread" ? agentSession.activeTurn.threadId : null;
  const isAgentWorkingForActiveThread =
    agentSession?.status === "running" && activeThread ? workingThreadId === activeThread.id || !workingThreadId : false;

  return (
    <div className="panel-body">
      {selectionDraft ? (
        <section className="new-thread-box">
          <div className="selection-label">
            <Highlighter size={15} />
            New anchored thread
          </div>
          <blockquote>{selectionDraft.exact}</blockquote>
          <SkillComposer
            value={newComment}
            onChange={onSetNewComment}
            selectedSkillIds={newThreadSkillIds}
            onSelectedSkillIdsChange={onSetNewThreadSkillIds}
            skills={agentSkills}
            placeholder="Leave a note for the agent..."
            ariaLabel="New thread comment"
            rows={4}
            submitLabel="Add thread"
            submitIcon={<MessageSquare size={15} />}
            onSubmit={onAddThread}
          />
          <div className="button-row">
            <button type="button" className="ghost-button" onClick={onClearSelection}>
              <X size={15} />
              Clear
            </button>
          </div>
        </section>
      ) : null}

      <div className="thread-list-toolbar">
        <span>
          {threads.length} visible · {resolvedThreadCount} resolved
        </span>
        <button type="button"
          className="ghost-button small"
          onClick={onToggleResolvedThreads}
          disabled={resolvedThreadCount === 0}
          title={showResolvedThreads ? "Hide resolved threads" : "Show resolved threads"}
        >
          {showResolvedThreads ? <EyeOff size={13} /> : <Eye size={13} />}
          {showResolvedThreads ? "Hide resolved" : "Show resolved"}
        </button>
      </div>

      <section className="thread-list">
        {threads.length === 0 ? (
          <p className="empty-note">
            {resolvedThreadCount > 0 && !showResolvedThreads
              ? "All resolved threads are hidden."
              : "Select text in the canvas, then use the comment button in the toolbar."}
          </p>
        ) : (
          threads.map((thread, index) => (
            <button type="button"
              key={thread.id}
              className={`thread-card ${thread.id === activeThreadId ? "is-active" : ""} ${
                thread.status === "resolved" ? "is-resolved" : ""
              } ${workingThreadId === thread.id ? "is-agent-working" : ""}`}
              onClick={() => onActivateThread(thread.id)}
            >
              <span className="thread-index">{index + 1}</span>
              <span>
                <strong>{thread.anchor.exact}</strong>
                <small>
                  {workingThreadId === thread.id
                    ? "Agent drafting"
                    : `${thread.messages.length} message${thread.messages.length === 1 ? "" : "s"} · ${thread.status}`}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))
        )}
      </section>

      {activeThread ? (
        <section className="thread-detail">
          <div className="thread-detail-header">
            <span>{activeThread.status}</span>
            <div className="thread-actions">
              <button type="button"
                className="secondary-button small"
                disabled={isAgentWorkingForActiveThread}
                onClick={() => onRequestAgentReply(activeThread.id)}
              >
                <Sparkles size={14} />
                Ask agent
              </button>
              <button type="button"
                className="ghost-button small"
                onClick={() => onSetStatus(activeThread.id, activeThread.status === "open" ? "resolved" : "open")}
              >
                {activeThread.status === "open" ? "Resolve" : "Reopen"}
              </button>
            </div>
          </div>
          <button type="button" className="thread-anchor-preview" onClick={() => onActivateThread(activeThread.id)}>
            {activeThread.anchor.exact}
          </button>

          <div className="message-stack">
            {activeThread.messages.map((message) => (
              <article
                key={message.id}
                className={`message-bubble is-${message.author} ${
                  message.author === "agent" && message.body.startsWith("Agent run failed:") ? "is-error" : ""
                }`}
              >
                <div>
                  <strong>{authorLabels[message.author]}</strong>
                  <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                {message.body ? <p>{message.body}</p> : null}
                <MessageSkillChips skills={message.skills} />
              </article>
            ))}
            {isAgentWorkingForActiveThread ? <AgentTypingIndicator label="Agent is drafting a thread reply" /> : null}
            {agentSession?.status === "error" && agentSession.lastError ? (
              <article className="message-bubble is-error">
                <div>
                  <strong>Agent error</strong>
                  <span>Retry available</span>
                </div>
                <p>{agentSession.lastError}</p>
              </article>
            ) : null}
          </div>

          {activeThread.suggestions.length > 0 ? (
            <div className="suggestion-stack">
              {activeThread.suggestions.map((suggestion) => (
                <article key={suggestion.id} className={`suggestion-card is-${suggestion.status}`}>
                  <div className="suggestion-meta">
                    <strong>Suggested replacement</strong>
                    <span>{suggestion.status}</span>
                  </div>
                  <p>{suggestion.replacement}</p>
                  {suggestion.status === "open" ? (
                    <div className="button-row">
                      <button type="button" className="primary-button" onClick={() => onSuggestionStatus(activeThread.id, suggestion.id, "accepted")}>
                        <Check size={15} />
                        Accept
                      </button>
                      <button type="button" className="ghost-button" onClick={() => onSuggestionStatus(activeThread.id, suggestion.id, "rejected")}>
                        <X size={15} />
                        Reject
                      </button>
                    </div>
                  ) : suggestion.status === "accepted" && !markdown.includes(suggestion.replacement) ? (
                    <div className="button-row">
                      <button type="button" className="secondary-button" onClick={() => onSuggestionStatus(activeThread.id, suggestion.id, "accepted")}>
                        <Check size={15} />
                        Apply to doc
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          <div className="composer">
            <SkillComposer
              value={replyDrafts[activeThread.id] ?? ""}
              onChange={(value) =>
                onSetReplyDrafts((drafts) => ({
                  ...drafts,
                  [activeThread.id]: value
                }))
              }
              selectedSkillIds={threadSkillIds[activeThread.id] ?? defaultSkillIds}
              onSelectedSkillIdsChange={(skillIds) =>
                onSetThreadSkillIds((drafts) => ({
                  ...drafts,
                  [activeThread.id]: skillIds
                }))
              }
              skills={agentSkills}
              rows={3}
              placeholder="Reply in this thread..."
              ariaLabel="Thread reply"
              submitLabel="Reply"
              submitIcon={<Send size={15} />}
              onSubmit={() => onAddMessage(activeThread.id)}
            />
          </div>

        </section>
      ) : null}
    </div>
  );
}

function InlineProposalReviewBar({
  review,
  proposalCount,
  onProposalStatus,
  onRequestProposalRewrite
}: {
  review: InlineProposalReview | null;
  proposalCount: number;
  onProposalStatus: (proposalId: string, status: "accepted" | "rejected") => void;
  onRequestProposalRewrite: (proposalId: string) => void;
}) {
  if (!review) return null;

  return (
    <section className="inline-proposal-review-bar" aria-label="Active agent proposal">
      <div>
        <span>Agent proposal</span>
        <strong>{review.proposal.title}</strong>
        <small>
          {review.decidedCount}/{review.changes.length} changes reviewed
          {proposalCount > 1 ? ` · ${proposalCount - 1} more in Chat` : ""}
        </small>
      </div>
      <p>{review.proposal.summary}</p>
      <div className="button-row compact">
        <button type="button" className="secondary-button" onClick={() => onRequestProposalRewrite(review.proposal.id)}>
          <RefreshCw size={15} />
          Rewrite proposal
        </button>
        <button type="button" className="primary-button" onClick={() => onProposalStatus(review.proposal.id, "accepted")}>
          <Check size={15} />
          Accept all
        </button>
        <button type="button" className="ghost-button" onClick={() => onProposalStatus(review.proposal.id, "rejected")}>
          <X size={15} />
          Decline all
        </button>
      </div>
    </section>
  );
}

function diffLineText(line: string) {
  return line.replace(/\r?\n$/, "") || " ";
}

function clippedDiffLines(lines: string[], maxCharacters?: number) {
  if (!maxCharacters) return lines;

  let remaining = maxCharacters;
  const clipped: string[] = [];
  for (const line of lines) {
    if (remaining <= 0) break;
    const text = diffLineText(line);
    clipped.push(text.length > remaining ? `${text.slice(0, Math.max(0, remaining - 3))}...` : line);
    remaining -= text.length;
  }
  return clipped;
}

function ProposalChangePreview({
  change,
  mode,
  variant,
  maxCharacters
}: {
  change: ProposalChangeBlock;
  mode: SupportedDiffViewMode;
  variant: "inline" | "panel";
  maxCharacters?: number;
}) {
  if (mode === "unified") {
    const deletions = clippedDiffLines(change.deletions, maxCharacters);
    const additions = clippedDiffLines(change.additions, maxCharacters);
    return (
      <div className={`proposal-change-preview is-unified is-${variant}`}>
        <span>Unified diff</span>
        <div className="proposal-unified-lines">
          {deletions.length > 0 ? (
            deletions.map((line, index) => (
              <div key={`delete-${index}`} className="proposal-unified-line is-delete">
                <b>-</b>
                <code>{diffLineText(line)}</code>
              </div>
            ))
          ) : (
            <div className="proposal-unified-line is-context">
              <b> </b>
              <code>(insert)</code>
            </div>
          )}
          {additions.length > 0 ? (
            additions.map((line, index) => (
              <div key={`add-${index}`} className="proposal-unified-line is-add">
                <b>+</b>
                <code>{diffLineText(line)}</code>
              </div>
            ))
          ) : (
            <div className="proposal-unified-line is-context">
              <b> </b>
              <code>(delete)</code>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`proposal-change-preview is-split is-${variant}`}>
      <div>
        <span>{variant === "inline" ? "Current" : "Original"}</span>
        {variant === "inline" ? (
          <p>{trimBlockText(change.deletions)}</p>
        ) : (
          <pre>{trimBlockText(change.deletions).slice(0, maxCharacters ?? 900)}</pre>
        )}
      </div>
      <div>
        <span>Proposed</span>
        {variant === "inline" ? (
          <p>{trimBlockText(change.additions)}</p>
        ) : (
          <pre>{trimBlockText(change.additions).slice(0, maxCharacters ?? 900)}</pre>
        )}
      </div>
    </div>
  );
}

function InlineProposalChangeCard({
  change,
  diffViewMode,
  onProposalChangeDecision,
  onRequestProposalRevision
}: {
  change: InlineProposalChange;
  diffViewMode: SupportedDiffViewMode;
  onProposalChangeDecision: (proposalId: string, changeKey: string, decision: ProposalChangeDecision) => void;
  onRequestProposalRevision: (proposalId: string, change: ProposalChangeBlock, instruction: string) => void;
}) {
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [revisionDraft, setRevisionDraft] = useState("");
  const decisionLabel = change.decision === "accepted" ? "accepted" : change.decision === "rejected" ? "declined" : "pending";
  const rewriteInstruction =
    "Rewrite this proposed change from scratch. Keep the underlying editorial intent, preserve the author's voice, and return a cleaner alternative rather than a minor polish.";

  return (
    <section
      className={`inline-proposal-change is-${change.decision ?? "pending"}`}
      data-inline-proposal-change
      data-change-key={change.key}
      contentEditable={false}
      tabIndex={-1}
    >
      <div className="inline-proposal-change-header">
        <div>
          <strong>Change {change.ordinal}</strong>
          <span>{decisionLabel}</span>
        </div>
        <small>
          -{lineRangeLabel(change.deletionLineStart, change.deletions.length)} · +
          {lineRangeLabel(change.additionLineStart, change.additions.length)}
        </small>
      </div>
      <ProposalChangePreview change={change} mode={diffViewMode} variant="inline" />
      <div className="button-row compact">
        <button type="button"
          className={change.decision === "accepted" ? "primary-button" : "secondary-button"}
          onClick={(event) => {
            const nextChangeKey = getNextInlineChangeKey(event.currentTarget);
            onProposalChangeDecision(change.proposalId, change.key, "accepted");
            scrollToInlineChange(nextChangeKey);
          }}
        >
          <Check size={15} />
          Accept
        </button>
        <button type="button"
          className={change.decision === "rejected" ? "ghost-button is-active" : "ghost-button"}
          onClick={(event) => {
            const nextChangeKey = getNextInlineChangeKey(event.currentTarget);
            onProposalChangeDecision(change.proposalId, change.key, "rejected");
            scrollToInlineChange(nextChangeKey);
          }}
        >
          <X size={15} />
          Decline
        </button>
        <button type="button"
          className="secondary-button"
          onClick={() => onRequestProposalRevision(change.proposalId, change, rewriteInstruction)}
        >
          <RefreshCw size={15} />
          Rewrite
        </button>
        <button type="button" className="ghost-button" onClick={() => setIsCommentOpen((value) => !value)}>
          <MessageSquare size={15} />
          Comment
        </button>
      </div>
      {isCommentOpen ? (
        <div className="revision-composer revision-comment-composer">
          <textarea
            value={revisionDraft}
            aria-label="Revision comment"
            onChange={(event) => setRevisionDraft(event.target.value)}
            rows={3}
            placeholder="Send a revision comment to the agent..."
          />
          <button type="button"
            className="primary-button"
            onClick={() => {
              onRequestProposalRevision(change.proposalId, change, revisionDraft);
              setRevisionDraft("");
              setIsCommentOpen(false);
            }}
            disabled={!revisionDraft.trim()}
          >
            <Send size={15} />
            Send comment
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface ChatPanelProps {
  messages: ChatMessage[];
  proposals: DocumentProposal[];
  contextLedger: ContextLedgerEvent[];
  agentSession?: AgentSession;
  chatDraft: string;
  agentSkills: AgentSkill[];
  selectedSkillIds: string[];
  diffViewMode: SupportedDiffViewMode;
  onSetChatDraft: (value: string) => void;
  onSetSelectedSkillIds: (value: string[]) => void;
  onSend: () => void;
  onProposalStatus: (proposalId: string, status: "accepted" | "rejected") => void;
  onProposalChangeDecision: (proposalId: string, changeKey: string, decision: ProposalChangeDecision) => void;
  onRequestProposalRevision: (proposalId: string, change: ProposalChangeBlock, instruction: string) => void;
}

function ChatPanel({
  messages,
  proposals,
  contextLedger,
  agentSession,
  chatDraft,
  agentSkills,
  selectedSkillIds,
  diffViewMode,
  onSetChatDraft,
  onSetSelectedSkillIds,
  onSend,
  onProposalStatus,
  onProposalChangeDecision,
  onRequestProposalRevision
}: ChatPanelProps) {
  const isAgentWorkingInChat = agentSession?.status === "running" && agentSession.activeTurn?.source === "chat";
  const openProposals = proposals
    .filter((proposal) => proposal.status === "open" || proposal.status === "reviewed")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const recentLedger = contextLedger.slice(-5).reverse();
  const decisionCount = contextLedger.filter(
    (event) =>
      event.type === "proposal_decision" ||
      event.type === "proposal_change_decision" ||
      event.type === "thread_suggestion_decision"
  ).length;
  return (
    <div className="panel-body chat-panel">
      <div className="message-stack chat-stack">
        <section className="memory-card">
          <div className="memory-card-header">
            <span>Context memory</span>
            <strong>{contextLedger.length}</strong>
          </div>
          <p>{decisionCount} editorial decisions recorded for future agent turns.</p>
          {recentLedger.length > 0 ? (
            <ol>
              {recentLedger.map((event) => (
                <li key={event.id}>
                  <span>{event.type.replace(/_/g, " ")}</span>
                  {event.summary}
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-note">Memory starts filling as you chat, comment, and review changes.</p>
          )}
        </section>
        {openProposals.length > 0 ? (
          <div className="proposal-stack">
            {openProposals.map((proposal) => (
              <DocumentProposalCard
                key={proposal.id}
                proposal={proposal}
                diffViewMode={diffViewMode}
                onProposalStatus={onProposalStatus}
                onProposalChangeDecision={onProposalChangeDecision}
                onRequestProposalRevision={onRequestProposalRevision}
              />
            ))}
          </div>
        ) : null}
        {messages.length === 0 ? (
          <p className="empty-note">Use chat for article-level discussion. Anchored edits belong in Threads.</p>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={`message-bubble is-${message.author} ${
                message.author === "agent" && message.body.startsWith("Agent run failed:") ? "is-error" : ""
              }`}
            >
              <div>
                <strong>{authorLabels[message.author]}</strong>
                <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              {message.body ? <p>{message.body}</p> : null}
              <MessageSkillChips skills={message.skills} />
            </article>
          ))
        )}
        {isAgentWorkingInChat ? <AgentTypingIndicator label="Agent is drafting a reply" /> : null}
      </div>

      <div className="composer chat-composer">
        <SkillComposer
          value={chatDraft}
          onChange={onSetChatDraft}
          selectedSkillIds={selectedSkillIds}
          onSelectedSkillIdsChange={onSetSelectedSkillIds}
          skills={agentSkills}
          rows={5}
          placeholder="Discuss the draft, ask for a pass, or leave agent instructions..."
          ariaLabel="Chat message"
          submitLabel="Send"
          submitIcon={<Send size={15} />}
          onSubmit={onSend}
        />
      </div>
    </div>
  );
}

function DocumentProposalCard({
  proposal,
  diffViewMode,
  onProposalStatus,
  onProposalChangeDecision,
  onRequestProposalRevision
}: {
  proposal: DocumentProposal;
  diffViewMode: SupportedDiffViewMode;
  onProposalStatus: (proposalId: string, status: "accepted" | "rejected") => void;
  onProposalChangeDecision: (proposalId: string, changeKey: string, decision: ProposalChangeDecision) => void;
  onRequestProposalRevision: (proposalId: string, change: ProposalChangeBlock, instruction: string) => void;
}) {
  const [openRevisionKey, setOpenRevisionKey] = useState<string | null>(null);
  const [revisionDrafts, setRevisionDrafts] = useState<Record<string, string>>({});
  const originalWords = wordCount(proposal.originalMarkdown);
  const replacementWords = wordCount(proposal.replacementMarkdown);
  const delta = replacementWords - originalWords;
  const proposalDiff = useMemo(() => buildProposalDiff(proposal), [proposal]);
  const changes = useMemo(() => getProposalChangeBlocks(proposalDiff), [proposalDiff]);
  const decisions = proposal.changeDecisions ?? {};
  const decidedCount = changes.filter((change) => decisions[change.key]).length;
  const pendingChanges = changes.filter((change) => !decisions[change.key]);

  return (
    <article className="document-proposal-card">
      <div className="proposal-meta">
        <strong>{proposal.title}</strong>
        <span>
          {delta >= 0 ? "+" : ""}
          {delta} words · {decidedCount}/{changes.length} reviewed
        </span>
      </div>
      <p>{proposal.summary}</p>

      {proposalDiff ? (
        <div className="proposal-diff-shell">
          <MultiFileDiff
            oldFile={{
              name: "draft.md",
              contents: proposal.originalMarkdown,
              lang: "markdown",
              cacheKey: `${proposal.id}:old`
            }}
            newFile={{
              name: "draft.md",
              contents: proposal.replacementMarkdown,
              lang: "markdown",
              cacheKey: `${proposal.id}:new`
            }}
            options={{
              diffStyle: diffViewMode,
              disableFileHeader: true,
              hunkSeparators: "line-info-basic",
              lineDiffType: "word-alt",
              overflow: "wrap",
              theme: "pierre-light",
              themeType: "light"
            }}
            disableWorkerPool
          />
        </div>
      ) : (
        <p className="empty-note">No diff preview is available for this proposal.</p>
      )}

      {pendingChanges.length > 0 ? (
        <div className="proposal-change-list">
          {pendingChanges.map((change) => {
            const decision = decisions[change.key];
            const revisionDraft = revisionDrafts[change.key] ?? "";
            const rewriteInstruction =
              "Rewrite this proposed change from scratch. Keep the underlying editorial intent, preserve the author's voice, and return a cleaner alternative rather than a minor polish.";
            return (
              <section key={change.key} className={`proposal-change-block is-${decision ?? "pending"}`}>
                <div className="change-block-header">
                  <strong>Change {change.ordinal}</strong>
                  <span>
                    -{lineRangeLabel(change.deletionLineStart, change.deletions.length)} · +
                    {lineRangeLabel(change.additionLineStart, change.additions.length)}
                  </span>
                </div>
                <ProposalChangePreview change={change} mode={diffViewMode} variant="panel" maxCharacters={900} />
                <div className="button-row">
                  <button type="button"
                    className={decision === "accepted" ? "primary-button" : "secondary-button"}
                    onClick={() => onProposalChangeDecision(proposal.id, change.key, "accepted")}
                  >
                    <Check size={15} />
                    Accept block
                  </button>
                  <button type="button"
                    className={decision === "rejected" ? "ghost-button is-active" : "ghost-button"}
                    onClick={() => onProposalChangeDecision(proposal.id, change.key, "rejected")}
                  >
                    <X size={15} />
                    Decline
                  </button>
                  <button type="button"
                    className="secondary-button"
                    onClick={() => onRequestProposalRevision(proposal.id, change, rewriteInstruction)}
                  >
                    <RefreshCw size={15} />
                    Rewrite
                  </button>
                  <button type="button"
                    className="ghost-button"
                    onClick={() => setOpenRevisionKey(openRevisionKey === change.key ? null : change.key)}
                  >
                    <MessageSquare size={15} />
                    Comment
                  </button>
                </div>
                {openRevisionKey === change.key ? (
                  <div className="revision-composer revision-comment-composer">
                    <textarea
                      value={revisionDraft}
                      aria-label="Revision comment"
                      onChange={(event) =>
                        setRevisionDrafts((drafts) => ({
                          ...drafts,
                          [change.key]: event.target.value
                        }))
                      }
                      rows={3}
                      placeholder="Send a revision comment to the agent..."
                    />
                    <button type="button"
                      className="primary-button"
                      onClick={() => {
                        onRequestProposalRevision(proposal.id, change, revisionDraft);
                        setOpenRevisionKey(null);
                        setRevisionDrafts((drafts) => ({ ...drafts, [change.key]: "" }));
                      }}
                      disabled={!revisionDraft.trim()}
                    >
                      <Send size={15} />
                      Send comment
                    </button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="empty-note">No line-level changes were detected in this proposal.</p>
      )}

      <div className="button-row">
        <button type="button" className="primary-button" onClick={() => onProposalStatus(proposal.id, "accepted")}>
          <Check size={15} />
          Accept all
        </button>
        <button type="button" className="ghost-button" onClick={() => onProposalStatus(proposal.id, "rejected")}>
          <X size={15} />
          Decline all
        </button>
      </div>
    </article>
  );
}

function AgentTypingIndicator({ label }: { label: string }) {
  return (
    <article className="message-bubble is-agent is-typing">
      <div>
        <strong>Agent</strong>
        <span>{label}</span>
      </div>
      <p aria-live="polite">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </p>
    </article>
  );
}

export default App;
