import React, { use, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { MultiFileDiff } from "@pierre/diffs/react";
import {
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
  Minus,
  Pilcrow,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Send,
  Settings,
  Sparkles,
  SquareCode,
  Strikethrough,
  Table,
  Upload,
  X
} from "lucide-react";
import {
  fetchAppSettings,
  fetchAgentSkills,
  fetchAgentRuntimes,
  fetchDocument,
  fetchRevisionHistory,
  restoreDocumentRevision,
  saveDocument,
  sendAgentMessage,
  subscribeToDocumentEvents,
  updateAgentConfig,
  updateAppSettings,
  uploadImageAsset
} from "./api";
import {
  displayAgentMessageBody,
  findSkillByCommand,
  getActiveSlashCommand,
  prepareAgentTurnDraft,
  skillLabel,
  skillMatchesQuery,
  uniqueSkillIds
} from "./agentDrafts";
import {
  AGENT_RUNTIME_UNAVAILABLE_MESSAGE,
  AGENT_RUNTIME_UNAVAILABLE_SHORT,
  AGENT_RUNTIME_UNAVAILABLE_TITLE,
  agentModelDraftFromConfiguredModel,
  effectiveRuntimeId,
  mergeRuntimeConfigFromSession,
  providerSelectValue as resolveProviderSelectValue,
  selectedRuntimeDisplayLabel
} from "./agentRuntimeState";
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
  isThematicBreak,
  looksLikeMarkdownPaste,
  markdownBlockIdFromIndex,
  normalizeMarkdownPaste,
  parseMarkdownTable,
  parseMarkdownImage,
  parseMarkdownBlocks,
  reconcileBlockIds,
  moveMarkdownBlock,
  serializeMarkdownBlocks,
  shouldPasteAsMarkdownBlocks,
  spliceMarkdownPaste,
  updateMarkdownBlock,
  updateMarkdownBlockShape,
  withTableColumnAdded,
  withTableColumnRemoved,
  withTableRowAdded,
  withTableRowRemoved
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
import { AgentTypingIndicator } from "./AgentTypingIndicator";
import {
  appControllerReducer,
  createAppControllerSetters,
  createAppControllerState
} from "./appControllerState";
import type {
  FloatingToolbarState,
  LinkPopoverState,
  PanelMode,
  SaveState,
  SelectionContextMenuState
} from "./appControllerState";
import { SettingsDialog } from "./SettingsDialog";
import {
  appThemeOptions,
  diffViewModeOptions,
  documentFontOptions
} from "./settingsOptions";
import { FirstRunAgentDialog } from "./FirstRunAgentDialog";
import { ToneSetupDialog } from "./ToneSetupDialog";
import { stickToBottomIfNear } from "./useStickToBottomScroll";
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
  SelectionDraft
} from "./types";

type SupportedEditorLanguage = EditorLanguage;
type SupportedDocumentFont = DocumentFont;
type SupportedAppTheme = AppTheme;
type SupportedDiffViewMode = DiffViewMode;
type BlockDropPlacement = "before" | "after";
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

function popDistinctSnapshot(stack: HistorySnapshot[], current: HistorySnapshot) {
  const nextStack = [...stack];
  let target = nextStack.pop() ?? null;

  while (target && snapshotsMatch(target, current)) {
    target = nextStack.pop() ?? null;
  }

  return { target, stack: nextStack };
}

// Serialize an edited code block's DOM to plain text, preserving every newline,
// blank line, and leading indentation. The generic htmlToInlineMarkdown path
// collapses runs of newlines, trims, and treats backticks/underscores as
// Markdown \u2014 all wrong for code. contentEditable represents line breaks as <br>
// or wrapping <div>/<p> elements, so reconstruct newlines from those.
function editableCodeNodeToText(node: HTMLElement) {
  let text = "";
  const walk = (current: Node) => {
    for (const child of Array.from(current.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? "";
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "br") {
        text += "\n";
        continue;
      }
      if (tag === "div" || tag === "p") {
        if (text && !text.endsWith("\n")) text += "\n";
        walk(child);
        continue;
      }
      walk(child);
    }
  };
  walk(node);
  return text.replace(/\u00a0/g, " ").replace(/\u200b/g, "");
}

function blockNodeToMarkdown(node: HTMLElement, blockType?: string) {
  if (blockType === "code") return editableCodeNodeToText(node);
  const html = blockType === "table" ? node.outerHTML : node.innerHTML;
  return htmlToInlineMarkdown(html.replace(/\u00a0/g, " ").trimEnd());
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

function isProposalReviewTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest(".inline-proposal-review-bar, .inline-proposal-change"))
  );
}

function floatingToolbarPositionFromPoint(clientX: number, clientY: number): FloatingToolbarState {
  const above = clientY > 70;
  return {
    left: clamp(clientX, 90, window.innerWidth - 90),
    top: above ? clientY - 52 : clientY + 18,
    placement: above ? "above" : "below"
  };
}

function getEditableBlockForRange(range: Range) {
  const startBlock = closestEditableBlock(range.startContainer);
  const endBlock = closestEditableBlock(range.endContainer);
  return startBlock && startBlock === endBlock ? startBlock : null;
}

function setClipboardEventPayload(clipboardData: DataTransfer, payload: ClipboardPayload) {
  clipboardData.setData("text/plain", payload.plainText);
  if (payload.markdown) clipboardData.setData("text/markdown", payload.markdown);
}

function isImageFile(file: File | null | undefined) {
  return Boolean(file && file.type.startsWith("image/"));
}

function handleCanvasDragOver(event: React.DragEvent<HTMLElement>) {
  if (!Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function keepSelection(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function currentBlockIdFromSelection() {
  const selection = window.getSelection();
  const node = selection?.focusNode ?? selection?.anchorNode;
  return node ? closestEditableBlock(node)?.dataset.blockId ?? null : null;
}

const defaultAppSettings: AppSettings = {
  version: 1,
  userName: "",
  toneOfVoice: "",
  toneOfVoiceSetupComplete: false,
  editorLanguage: "en-GB",
  documentFont: "default",
  theme: "default",
  agentRuntime: "auto",
  agentModel: "auto",
  agentEffort: "auto",
  localInferenceBaseUrl: "",
  localInferenceApiKey: "",
  localInferenceMaxTokens: 4096,
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
  const userName = typeof settings?.userName === "string" ? settings.userName.slice(0, 120) : defaultAppSettings.userName;
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
    userName,
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

function humanAuthorLabel(settings: Pick<AppSettings, "userName">) {
  const name = settings.userName.trim();
  return name || "You";
}

function authorLabel(author: Author, humanLabel: string) {
  return author === "human" ? humanLabel : "Agent";
}

function formatLedgerSummaryForDisplay(summary: string, humanLabel: string) {
  return summary.replace(/\bHuman\b/g, humanLabel);
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

const maxContextLedgerEvents = 240;

interface BlockAnchorRange {
  thread: ReviewThread;
  start: number;
  end: number;
}

const emptyBlockAnchorRanges: BlockAnchorRange[] = [];

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

function renderKeyHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function keyedRenderItems<T>(items: T[], prefix: string, signature: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const compact = signature(item).replace(/\s+/g, " ").trim() || "blank";
    const occurrence = occurrences.get(compact) ?? 0;
    occurrences.set(compact, occurrence + 1);
    return {
      item,
      key: `${prefix}-${renderKeyHash(compact)}-${occurrence}`
    };
  });
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

function placeCaretInEditableBlock(node: HTMLElement, plainOffset: number) {
  node.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(true);

  if (plainOffset > 0) {
    let remaining = plainOffset;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const length = textNode.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(textNode, remaining);
        range.collapse(true);
        break;
      }
      remaining -= length;
      textNode = walker.nextNode();
    }
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

function buildSelectionFromCanvasRange(
  markdown: string,
  range: Range,
  blocks: ReturnType<typeof parseMarkdownBlocks>
): SelectionDraft | null {
  const startBlockNode = closestEditableBlock(range.startContainer);
  const endBlockNode = closestEditableBlock(range.endContainer);
  const startBlockId = startBlockNode?.dataset.blockId;
  const endBlockId = endBlockNode?.dataset.blockId;
  if (!startBlockNode || !endBlockNode || !startBlockId || !endBlockId) return null;

  const spans = getMarkdownBlockLineSpans(markdown);
  // Block ids are stable (reconciled); spans come from a positional re-parse, so
  // resolve via the block's index in document order.
  const startIndex = blocks.findIndex((block) => block.id === startBlockId);
  const endIndex = blocks.findIndex((block) => block.id === endBlockId);
  const startSpan = startIndex >= 0 ? spans[startIndex] : undefined;
  const endSpan = endIndex >= 0 ? spans[endIndex] : undefined;
  const startBlock = startIndex >= 0 ? blocks[startIndex] : undefined;
  const endBlock = endIndex >= 0 ? blocks[endIndex] : undefined;
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
  /`([^`]+)`|!\[([^\]\n]*)\]\(([^)\s]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)|<((?:https?|mailto):[^>\s]+)>|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|\n/g;

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

    const [raw, code, imageAlt, imageSrc, linkLabel, linkHref, autolink, boldAsterisk, boldUnderscore, strike, italicAsterisk, italicUnderscore] = match;
    const nodeKey = `${keyPrefix}-${key++}`;

    if (code !== undefined) {
      nodes.push(<code key={nodeKey}>{code}</code>);
    } else if (imageSrc !== undefined) {
      // Inline image: display through imagePreviewSrc but keep the original markdown
      // src in data-md-src so htmlToInlineMarkdown round-trips it (the preview src
      // may be rewritten to /api/assets for non-http paths).
      nodes.push(
        <img
          key={nodeKey}
          className="inline-image"
          src={imagePreviewSrc(imageSrc)}
          data-md-src={imageSrc}
          alt={imageAlt ?? ""}
          loading="lazy"
        />
      );
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
    } else if (autolink !== undefined) {
      // An autolink shows the URL itself as the link text (the <> are hidden).
      const safeHref = safeRenderedMarkdownHref(autolink);
      nodes.push(
        safeHref ? (
          <a key={nodeKey} href={safeHref} target="_blank" rel="noreferrer">
            {autolink}
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

// Block types whose shape can be swapped by the formatting controls (paragraph /
// heading / quote / list). Images, tables and code are left untouched.
// A structural edit to a table: add or delete a row/column. `index` is the
// body-row or column index for the delete variants (ignored by the adds).
type TableEdit =
  | { kind: "add-row" }
  | { kind: "add-column" }
  | { kind: "delete-row"; index: number }
  | { kind: "delete-column"; index: number };

function isShapeConvertibleType(type: string) {
  return (
    type === "paragraph" ||
    type === "heading" ||
    type === "quote" ||
    type === "ordered-list" ||
    type === "unordered-list"
  );
}

// Blocks with no editable text: they are kept verbatim on serialize (never
// re-read from the DOM) and get keyboard escapes (Enter/Backspace) instead of a
// caret. Images carry their markdown in `text`; a thematic break serializes to a
// fixed "---".
function isVoidBlockType(type: string) {
  return type === "image" || type === "thematic-break";
}

function isOlderDocument(candidate: DocumentState, current: DocumentState | null) {
  if (!current) return false;
  if (candidate.id !== current.id) return false;
  const candidateTime = Date.parse(candidate.review?.updatedAt ?? "");
  const currentTime = Date.parse(current.review?.updatedAt ?? "");
  return Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime < currentTime;
}

function useSkribeController() {
  const [controllerState, dispatchController] = useReducer(appControllerReducer, defaultAppSettings, createAppControllerState);
  const [isFlowMode, setIsFlowMode] = useState(false);
  const controllerSetters = useMemo(() => createAppControllerSetters(dispatchController), []);
  const {
    documentState,
    appSettings,
    settingsDraft,
    isSettingsOpen,
    firstRunStep,
    toneSetupInvocation,
    settingsSaveState,
    revisionState,
    agentSkills,
    agentRuntimeConfig,
    agentModelDraft,
    isAgentConfigOpen,
    isAgentModelMenuOpen,
    saveState,
    panelMode,
    activeThreadId,
    activeBlockId,
    isLeftRailCollapsed,
    isRightPanelCollapsed,
    isRestoringRevision,
    isRevisionHistoryOpen,
    selectionDraft,
    pendingSelectionDraft,
    newComment,
    replyDrafts,
    newThreadSkillIds,
    threadSkillIds,
    chatDraft,
    chatSkillIds,
    floatingToolbar,
    linkPopover,
    selectionContextMenu,
    linkDraft,
    lastCopied,
    blockResetKeys
  } = controllerState;
  const {
    setDocumentState,
    setAppSettings,
    setSettingsDraft,
    setIsSettingsOpen,
    setFirstRunStep,
    setToneSetupInvocation,
    setSettingsSaveState,
    setRevisionState,
    setAgentSkills,
    setAgentRuntimeConfig,
    setAgentModelDraft,
    setIsAgentConfigOpen,
    setIsAgentModelMenuOpen,
    setSaveState,
    setPanelMode,
    setActiveThreadId,
    setActiveBlockId,
    setIsLeftRailCollapsed,
    setIsRightPanelCollapsed,
    setIsRestoringRevision,
    setIsRevisionHistoryOpen,
    setSelectionDraft,
    setPendingSelectionDraft,
    setNewComment,
    setReplyDrafts,
    setNewThreadSkillIds,
    setThreadSkillIds,
    setChatDraft,
    setChatSkillIds,
    setFloatingToolbar,
    setLinkPopover,
    setSelectionContextMenu,
    setLinkDraft,
    setLastCopied,
    setBlockResetKeys
  } = controllerSetters;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingCaretRef = useRef<{ index: number; offset: number } | null>(null);
  const blockIdCounterRef = useRef(0);
  const reconciledBlocksRef = useRef<ReturnType<typeof parseMarkdownBlocks>>([]);
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
  const agentRuntimeRefreshInFlightRef = useRef(false);
  const agentRuntimeRefreshAtRef = useRef(0);
  const agentSession = documentState?.agentSession;

  const mintBlockId = useCallback(() => `b${(blockIdCounterRef.current += 1)}`, []);

  // Reconcile a markdown string into blocks whose ids are carried forward from the
  // last render, so a block's id tracks its content across edits/reflow instead of
  // its array position. Used for rendering and by handlers that resolve a block
  // from a DOM data-block-id. (Pure document.ts mutators still match positional
  // ids; translate with positionalBlockId at those boundaries.)
  const blocksForMarkdown = useCallback(
    (markdown: string) => reconcileBlockIds(reconciledBlocksRef.current, parseMarkdownBlocks(markdown), mintBlockId),
    [mintBlockId]
  );

  const reconciledBlocks = useMemo(
    () => blocksForMarkdown(documentState?.markdown ?? ""),
    [blocksForMarkdown, documentState?.markdown]
  );

  useLayoutEffect(() => {
    reconciledBlocksRef.current = reconciledBlocks;
  }, [reconciledBlocks]);

  const positionalBlockId = useCallback(
    (markdown: string, stableId: string) => {
      const index = blocksForMarkdown(markdown).findIndex((block) => block.id === stableId);
      return index >= 0 ? markdownBlockIdFromIndex(index) : stableId;
    },
    [blocksForMarkdown]
  );

  // Resolve a stable block id to its block plus its positional line span (spans
  // are derived from a positional re-parse, so align by document order).
  const blockWithSpanById = useCallback(
    (markdown: string, stableId: string) => {
      const list = blocksForMarkdown(markdown);
      const index = list.findIndex((block) => block.id === stableId);
      if (index < 0) return { block: null, span: null };
      return { block: list[index], span: getMarkdownBlockLineSpans(markdown)[index] ?? null };
    },
    [blocksForMarkdown]
  );

  const findBlockById = useCallback(
    (markdown: string, stableId: string) => blocksForMarkdown(markdown).find((block) => block.id === stableId) ?? null,
    [blocksForMarkdown]
  );

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
        setAgentModelDraft(agentModelDraftFromConfiguredModel(updated.config.configuredModel));
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
    [
      agentSession?.status,
      setAgentModelDraft,
      setAgentRuntimeConfig,
      setAppSettings,
      setDocumentState,
      setSaveState,
      setSettingsDraft
    ]
  );

  const refreshAgentRuntimes = useCallback(async () => {
    const now = Date.now();
    if (agentRuntimeRefreshInFlightRef.current) return;
    if (now - agentRuntimeRefreshAtRef.current < 3000) return;

    agentRuntimeRefreshInFlightRef.current = true;
    try {
      const runtimeConfig = await fetchAgentRuntimes({ refresh: true });
      setAgentRuntimeConfig(mergeRuntimeConfigFromSession(runtimeConfig, stateRef.current?.agentSession));
      setAgentModelDraft(agentModelDraftFromConfiguredModel(runtimeConfig.configuredModel));
      agentRuntimeRefreshAtRef.current = Date.now();
    } catch {
      // Runtime detection is best-effort; keep the last known config on failure.
    } finally {
      agentRuntimeRefreshInFlightRef.current = false;
    }
  }, [setAgentModelDraft, setAgentRuntimeConfig]);

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
        // The initial fetch can resolve after the writer has already started
        // editing (e.g. pressed Enter to split a block); don't let the on-disk
        // document clobber a newer in-progress edit. Mirrors handleRemoteDocument.
        if (!isOlderDocument(loaded, stateRef.current)) {
          stateRef.current = loaded;
          setDocumentState(loaded);
        }
        setRevisionState(revisions);
        setAgentSkills(skills);
        setAgentRuntimeConfig(runtimeConfig);
        setAgentModelDraft(agentModelDraftFromConfiguredModel(runtimeConfig.configuredModel));
        if (!loadedSettings.toneOfVoiceSetupComplete) setFirstRunStep("agent");
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  }, [
    setAgentModelDraft,
    setAgentRuntimeConfig,
    setAgentSkills,
    setAppSettings,
    setChatSkillIds,
    setDocumentState,
    setIsLeftRailCollapsed,
    setIsRightPanelCollapsed,
    setNewThreadSkillIds,
    setRevisionState,
    setSaveState,
    setFirstRunStep,
    setSettingsDraft
  ]);

  useEffect(() => {
    saveRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    if (!linkPopover) return;
    window.requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
  }, [linkPopover]);

  const refreshRevisions = useCallback(() => {
    fetchRevisionHistory()
      .then((revisions) => setRevisionState(revisions))
      .catch(() => undefined);
  }, [setRevisionState]);

  const handleRemoteDocument = useCallback(
    (remote: DocumentState) => {
      const current = stateRef.current;
      const switchedDocument = Boolean(current && remote.id !== current.id);
      if (isOlderDocument(remote, current)) return;
      const shouldSkipRender = switchedDocument ? false : shouldAvoidDocumentRenderWhileEditing(remote);
      if (switchedDocument) {
        clearPendingEditTimers();
        // Drop the previous document's reconciled blocks so the new document's
        // blocks aren't reconciled against stale ids (which could reuse React
        // keys/refs across documents and surface stale contentEditable DOM).
        reconciledBlocksRef.current = [];
        blockIdCounterRef.current = 0;
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
      const previousMarkdown = current?.markdown;
      stateRef.current = remote;
      if (!shouldSkipRender) {
        // A same-document remote/agent edit changes block content under reused
        // contentEditable nodes; remount them so the live DOM reflects the new
        // markdown instead of staying stale until the next click. (Switched
        // documents already cleared every block reset key above.)
        if (!switchedDocument && previousMarkdown !== undefined && remote.markdown !== previousMarkdown) {
          resetRenderedEditableBlocks(remote.markdown);
        }
        setDocumentState(remote);
      }
      if (remote.agentSession) {
        setAgentRuntimeConfig((current) => mergeRuntimeConfigFromSession(current, remote.agentSession));
      }
      if (saveRef.current !== "saving") setSaveState("saved");
    },
    [
      clearPendingEditTimers,
      refreshRevisions,
      setActiveBlockId,
      setActiveThreadId,
      setAgentRuntimeConfig,
      setBlockResetKeys,
      setDocumentState,
      setFloatingToolbar,
      setLinkPopover,
      setPendingSelectionDraft,
      setReplyDrafts,
      setSaveState,
      setSelectionContextMenu,
      setSelectionDraft,
      setThreadSkillIds
    ]
  );

  useEffect(() => subscribeToDocumentEvents(handleRemoteDocument), [handleRemoteDocument]);

  // After a structural edit remounts blocks (e.g. splitting a list item with
  // Enter), move the caret into the freshly rendered target block. We keep the
  // request pending and re-apply it on later re-renders (the post-commit save
  // can otherwise blur the empty new item) until the writer actually types —
  // `scheduleLiveCanvasCommit` clears it. We never reset the caret while the
  // block already holds focus, so this can't fight active typing.
  useLayoutEffect(() => {
    applyPendingCaret();
  }, [documentState, blockResetKeys]);

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
  }, [setFloatingToolbar]);

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
      setAgentModelDraft(agentModelDraftFromConfiguredModel(runtimeConfig.configuredModel));
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
    setFirstRunStep(null);
    setToneSetupInvocation(null);
  }

  async function skipToneOfVoiceSetup() {
    const nextSettings = mergeAppSettings({
      ...toneSettingsBase(),
      toneOfVoiceSetupComplete: true
    });
    setFirstRunStep(null);
    setToneSetupInvocation(null);
    await persistSettings(nextSettings);
  }

  function beginFirstRunToneSetup() {
    setFirstRunStep("tone");
    setToneSetupInvocation("first-run");
  }

  async function continueFirstRunAgentSetup() {
    await persistSettings(settingsDraft);
    beginFirstRunToneSetup();
  }

  function skipFirstRunAgentSetup() {
    setSettingsDraft(appSettings);
    beginFirstRunToneSetup();
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

  function openSettingsDialog() {
    setSettingsDraft(appSettings);
    setSettingsSaveState("saved");
    setIsSettingsOpen(true);
  }

  function cancelSettingsDialog() {
    setSettingsDraft(appSettings);
    setSettingsSaveState("saved");
    setIsSettingsOpen(false);
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
    // Undo/redo restores markdown out-of-band; force the contentEditable blocks
    // to remount so the live DOM reflects the restored document.
    resetRenderedEditableBlocks(next.markdown);
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

  function visibleEditableShells() {
    return Array.from(canvasRef.current?.querySelectorAll<HTMLElement>(".editable-document [data-block-shell]") ?? []);
  }

  function serializeVisibleCanvasMarkdown(markdown: string) {
    const shells = visibleEditableShells();
    if (shells.length === 0) return null;

    const sourceBlocks = blocksForMarkdown(markdown);
    const renderedState = documentState;
    const renderedMarkdown = renderedState && renderedState.id === stateRef.current?.id ? renderedState.markdown : null;
    const renderedBlocks = renderedMarkdown ? blocksForMarkdown(renderedMarkdown) : [];
    const blocksById = new Map<string, ReturnType<typeof parseMarkdownBlocks>[number]>();
    [...sourceBlocks, ...renderedBlocks].forEach((block) => blocksById.set(block.id, block));

    const blocks = shells.flatMap((shell) => {
      const blockId = shell.dataset.blockShell;
      if (!blockId) return [];

      const sourceBlock = blocksById.get(blockId) ?? {
        id: blockId,
        type: "paragraph" as const,
        text: ""
      };

      if (isVoidBlockType(sourceBlock.type)) return [sourceBlock];

      const node = shell.querySelector<HTMLElement>("[data-block-id]");
      if (!node) return [sourceBlock];

      const text = blockNodeToMarkdown(node, sourceBlock.type);
      if (text.trim()) return [{ ...sourceBlock, text }];
      // Keep an empty block while the caret is inside it — e.g. a block just
      // created with Enter that the writer is about to fill in. Lists round-trip
      // empty as "- "; other empty blocks need a zero-width-space sentinel so the
      // block survives re-parsing. Empty blocks are dropped once focus leaves them.
      if (node === document.activeElement || node.contains(document.activeElement)) {
        return [{ ...sourceBlock, text: "\u200b" }];
      }
      return [];
    });

    return serializeMarkdownBlocks(blocks);
  }

  function serializeCanvasMarkdown(markdown: string) {
    const visibleMarkdown = serializeVisibleCanvasMarkdown(markdown);
    if (visibleMarkdown !== null) return visibleMarkdown;

    const blocks = blocksForMarkdown(markdown);
    if (blocks.length === 0) {
      const emptyBlockId = markdownBlockIdFromIndex(0);
      const node = blockRefs.current[emptyBlockId];
      const text = node ? blockNodeToMarkdown(node, "paragraph") : "";
      return serializeMarkdownBlocks(text.trim() ? [{ id: emptyBlockId, type: "paragraph", text }] : []);
    }

    return serializeMarkdownBlocks(
      blocks.flatMap((block) => {
        if (isVoidBlockType(block.type)) return [block];
        const node = blockRefs.current[block.id];
        if (!node) return [block];
        const text = blockNodeToMarkdown(node, block.type);
        return text.trim() ? [{ ...block, text }] : [];
      })
    );
  }

  function resetRenderedEditableBlocks(markdown: string) {
    const ids = new Set(blocksForMarkdown(markdown).map((block) => block.id));
    visibleEditableShells().forEach((shell) => {
      if (shell.dataset.blockShell) ids.add(shell.dataset.blockShell);
    });
    if (ids.size === 0) ids.add(markdownBlockIdFromIndex(0));

    setBlockResetKeys((keys) => {
      const next = { ...keys };
      ids.forEach((id) => {
        next[id] = (next[id] ?? 0) + 1;
      });
      return next;
    });
  }

  function isCanvasFocused() {
    return Boolean(canvasRef.current && document.activeElement && canvasRef.current.contains(document.activeElement));
  }

  function shouldAvoidDocumentRenderWhileEditing(remote: DocumentState) {
    const current = stateRef.current;
    return Boolean(isCanvasFocused() && current && remote.markdown === current.markdown);
  }

  function commitCanvasDom() {
    // A structural edit that remounts blocks (e.g. a list split) blurs the old
    // focused node, which fires this on-blur handler. Re-serializing the DOM mid
    // transition would drop the freshly-created empty item before the caret has
    // moved into it, so skip until the pending caret has been placed.
    if (pendingCaretRef.current) return;

    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }

    const current = stateRef.current;
    if (!current) return;
    const next = stateWithLiveCanvasEdit(current);
    if (next === current) {
      if (documentState && current.markdown !== documentState.markdown) {
        resetRenderedEditableBlocks(current.markdown);
        setDocumentState(current);
      }
      liveEditHistoryActiveRef.current = false;
      return;
    }
    resetRenderedEditableBlocks(next.markdown);
    commit(() => next);
    liveEditHistoryActiveRef.current = false;
  }

  function scheduleLiveCanvasCommit() {
    // The writer is typing, so stop re-applying any pending caret placement
    // (e.g. from a just-split list item) — they now own the caret.
    pendingCaretRef.current = null;
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

  function commit(
    updater: (state: DocumentState) => DocumentState,
    options?: { resyncDom?: boolean }
  ) {
    if (!stateRef.current) return null;

    const current = stateRef.current;
    let next: DocumentState;
    let base: DocumentState;
    try {
      base = stateWithPendingLiveCanvasEdit(current);
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

    // Structural edits (paste, delete, move, proposal apply, …) change block
    // content/order programmatically while the live contentEditable DOM was
    // mutated out-of-band by the browser. React cannot reliably reconcile new
    // text into such a diverged contentEditable, so callers that restructure the
    // document opt into a forced remount to repaint the affected blocks instead
    // of leaving stale DOM until the next blur/click.
    if (options?.resyncDom && next.markdown !== base.markdown) {
      resetRenderedEditableBlocks(next.markdown);
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

    const { block, span } = blockWithSpanById(markdown, blockId);
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

    const { block, span } = blockWithSpanById(markdown, blockId);
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
        const previous = stateRef.current;
        stateRef.current = remote;
        // An agent reply can rewrite the document; remount the edited blocks so
        // the live editor shows the change rather than stale content.
        if (previous && remote.markdown !== previous.markdown) {
          resetRenderedEditableBlocks(remote.markdown);
        }
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
    const targetBlock = blocksForMarkdown(current.markdown).find((block) =>
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
    const nextSelection = buildSelectionFromCanvasRange(markdown, range, blocksForMarkdown(markdown)) ?? buildSelection(markdown, selectedText);
    setSelectionDraft(nextSelection);
    setPanelMode("threads");
    setFloatingToolbar(null);
  }

  function deletePendingMarkdownSelection() {
    const draft = pendingSelectionDraft;
    if (!draft) return false;

    let didDelete = false;
    commit(
      (state) => {
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
      },
      { resyncDom: true }
    );

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
      const selectedRange = buildSelectionFromCanvasRange(markdown, range, blocksForMarkdown(markdown));
      if (selectedRange) return resolveSelectionDraftRange(markdown, selectedRange);
    }

    const blockNode = closestEditableBlock(range.startContainer);
    const blockId = blockNode?.dataset.blockId;
    if (!blockNode || !blockId) return null;

    const blocks = blocksForMarkdown(markdown);
    if (blocks.length === 0 && blockId === markdownBlockIdFromIndex(0)) return { start: 0, end: 0 };

    const { block, span } = blockWithSpanById(markdown, blockId);
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

    commit(
      () => ({
        ...liveState,
        markdown,
        review: {
          ...liveState.review,
          updatedAt: nowIso()
        }
      }),
      { resyncDom: true }
    );
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

    commit(
      () => ({
        ...liveState,
        markdown,
        review: {
          ...liveState.review,
          updatedAt: nowIso()
        }
      }),
      { resyncDom: true }
    );
    clearCanvasSelectionState();
    showTransientToast(label);
    return true;
  }

  async function insertImageFiles(files: FileList | File[]) {
    const images = Array.from(files).filter(isImageFile);
    if (images.length === 0) return false;

    try {
      const assets = await Promise.all(images.map((image) => uploadImageAsset(image)));
      const markdown = assets.map((asset) => asset.markdown).join("\n\n");
      return insertMarkdownBlockAtCurrentRange(
        markdown,
        assets.length === 1 ? "Image inserted" : "Images inserted"
      );
    } catch (error) {
      console.error("Unable to insert image", error);
      showTransientToast("Image insert failed");
      return false;
    }
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
    // Block-shape shortcuts while a cross-block (custom) selection is active —
    // these otherwise live in the per-block handler, which doesn't fire because a
    // custom selection moves focus to the canvas. changeBlockShape reads the
    // selection draft and converts every block it covers.
    if (isCommand && event.altKey && ["0", "1", "2", "3", "4", "5", "6"].includes(key)) {
      event.preventDefault();
      if (key === "0") changeBlockShape({ type: "paragraph", level: undefined });
      else changeBlockShape({ type: "heading", level: Number(key) });
      return;
    }
    if (isCommand && event.shiftKey && key === "7") {
      event.preventDefault();
      changeBlockShape({ type: "ordered-list", marker: "1" });
      return;
    }
    if (isCommand && event.shiftKey && key === "8") {
      event.preventDefault();
      changeBlockShape({ type: "unordered-list" });
      return;
    }
    // Ctrl/Cmd+Shift+. (reports as ">" under Shift on many layouts) — blockquote.
    if (isCommand && event.shiftKey && (key === "." || key === ">")) {
      event.preventDefault();
      changeBlockShape({ type: "quote" });
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
    }, { resyncDom: true });
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
    }, { resyncDom: true });
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
    }, { resyncDom: true });
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
    const currentBlock = stateRef.current ? findBlockById(stateRef.current.markdown, blockId) : null;
    const registeredNode = blockRefs.current[blockId] ?? null;
    const text = registeredNode ? blockNodeToMarkdown(registeredNode, currentBlock?.type) : htmlToInlineMarkdown(html);
    const textBlocks: string[] = [];
    for (const part of text.split(/\n{2,}/)) {
      const trimmed = part.trim();
      if (trimmed) textBlocks.push(trimmed);
    }
    if (currentBlock && textBlocks.length > 1 && textBlocks[0] === currentBlock.text.trim()) {
      setBlockResetKeys((keys) => ({
        ...keys,
        [blockId]: (keys[blockId] ?? 0) + 1
      }));
    }
    commit((state) => ({
      ...state,
      markdown: updateMarkdownBlock(state.markdown, positionalBlockId(state.markdown, blockId), text),
      review: {
        ...state.review,
        updatedAt: nowIso()
      }
    }));
  }

  function moveCanvasBlock(blockId: string, targetBlockId: string, placement: BlockDropPlacement) {
    if (blockId === targetBlockId) return;
    commit(
      (state) => ({
        ...state,
        markdown: moveMarkdownBlock(
          state.markdown,
          positionalBlockId(state.markdown, blockId),
          positionalBlockId(state.markdown, targetBlockId),
          placement
        ),
        review: {
          ...state.review,
          updatedAt: nowIso()
        }
      }),
      { resyncDom: true }
    );
  }

  function deleteCanvasBlock(blockId: string) {
    if (!stateRef.current || !findBlockById(stateRef.current.markdown, blockId)) return;
    commit(
      (state) => ({
        ...state,
        markdown: deleteMarkdownBlock(state.markdown, positionalBlockId(state.markdown, blockId)),
        review: {
          ...state.review,
          updatedAt: nowIso()
        }
      }),
      { resyncDom: true }
    );
    if (activeBlockId === blockId) setActiveBlockId(null);
  }

  function registerBlockRef(blockId: string, node: HTMLElement | null) {
    blockRefs.current[blockId] = node;
  }

  function updateBlockShape(blockId: string, patch: Parameters<typeof updateMarkdownBlockShape>[2]) {
    const node = blockRefs.current[blockId];
    const currentBlock = stateRef.current ? findBlockById(stateRef.current.markdown, blockId) : null;
    const currentText = node ? blockNodeToMarkdown(node, currentBlock?.type) : null;

    // The commit below serializes the live DOM (capturing this and any other
    // block's in-progress edits) while the debounce timer is still armed, then
    // remounts the block under its new shape via resyncDom.
    commit((state) => {
      const positional = positionalBlockId(state.markdown, blockId);
      const markdownWithLatestText = currentText
        ? updateMarkdownBlock(state.markdown, positional, currentText)
        : state.markdown;
      return {
        ...state,
        markdown: updateMarkdownBlockShape(markdownWithLatestText, positional, patch),
        review: {
          ...state.review,
          updatedAt: nowIso()
        }
      };
    }, { resyncDom: true });

    // Cancel the pending live-edit debounce: its closure captured the
    // pre-conversion render (e.g. a heading) and, if left to fire, would
    // re-serialize the stale DOM type and silently revert the shape change.
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
  }

  // Flip a task-list item between done and not-done. Mirrors updateBlockShape:
  // captures the item's live text first so an in-progress edit isn't lost, then
  // commits the new checked state and remounts.
  function toggleTaskListItem(blockId: string) {
    const current = stateRef.current;
    if (!current) return;
    const block = findBlockById(current.markdown, blockId);
    if (!block || block.type !== "unordered-list" || block.checked === undefined) return;
    const node = blockRefs.current[blockId];
    const latestText = node ? blockNodeToMarkdown(node, block.type) : null;

    commit((state) => {
      const positional = positionalBlockId(state.markdown, blockId);
      const withText = latestText !== null ? updateMarkdownBlock(state.markdown, positional, latestText) : state.markdown;
      return {
        ...state,
        markdown: updateMarkdownBlockShape(withText, positional, { checked: !block.checked }),
        review: { ...state.review, updatedAt: nowIso() }
      };
    }, { resyncDom: true });

    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
  }

  // Add or remove a table row/column. Serializes the live table DOM first (so any
  // in-progress cell edits survive), applies the structure change to that Markdown,
  // then commits + remounts. A no-op transform (e.g. delete blocked by the 2-column
  // minimum) leaves the document untouched.
  function editTable(blockId: string, edit: TableEdit) {
    const current = stateRef.current;
    const node = blockRefs.current[blockId];
    if (!current || !node) return;
    const currentText = blockNodeToMarkdown(node, "table");
    const nextText =
      edit.kind === "add-row"
        ? withTableRowAdded(currentText)
        : edit.kind === "add-column"
          ? withTableColumnAdded(currentText)
          : edit.kind === "delete-row"
            ? withTableRowRemoved(currentText, edit.index ?? -1)
            : withTableColumnRemoved(currentText, edit.index ?? -1);
    if (nextText === currentText) return;

    commit((state) => {
      const positional = positionalBlockId(state.markdown, blockId);
      return {
        ...state,
        markdown: updateMarkdownBlock(state.markdown, positional, nextText),
        review: { ...state.review, updatedAt: nowIso() }
      };
    }, { resyncDom: true });

    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
  }

  // Put the caret at the end of a table cell's content. Focuses the editable table
  // first so the caret is real even when the cell lives in a freshly remounted node.
  function focusTableCell(cell: Element) {
    const selection = window.getSelection();
    if (!selection) return;
    (cell.closest("[contenteditable='true']") as HTMLElement | null)?.focus();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Move the caret to the next/previous table cell. Returns false (so the browser's
  // default Tab runs) when the caret isn't in a cell, or at the edges: Shift+Tab in
  // the first cell tabs out of the table. Tab past the last cell appends a row and
  // drops the caret into its first cell once it renders.
  function moveTableCell(blockId: string, backwards: boolean) {
    const tableNode = blockRefs.current[blockId];
    const selection = window.getSelection();
    if (!tableNode || !selection || selection.rangeCount === 0) return false;

    const start = selection.getRangeAt(0).startContainer;
    const startElement = start instanceof Element ? start : start.parentElement;
    const cell = startElement?.closest("th, td");
    if (!cell || !tableNode.contains(cell)) return false;

    const cells = Array.from(tableNode.querySelectorAll("th, td"));
    const targetIndex = cells.indexOf(cell) + (backwards ? -1 : 1);
    if (targetIndex < 0) return false;
    if (targetIndex >= cells.length) {
      if (backwards) return false;
      const priorRowCount = tableNode.querySelectorAll("tbody tr").length;
      editTable(blockId, { kind: "add-row" });
      // The add commits with resyncDom, so the new row appears after React remounts
      // the table. Poll a few frames (rather than a single rAF) until the extra row
      // exists, then focus its first cell — the remount can miss one frame under load.
      let attempts = 0;
      const focusNewRow = () => {
        const bodyRows = blockRefs.current[blockId]?.querySelectorAll("tbody tr");
        if (bodyRows && bodyRows.length > priorRowCount) {
          const firstCell = bodyRows[bodyRows.length - 1].querySelector("td");
          if (firstCell) focusTableCell(firstCell);
        } else if (attempts++ < 10) {
          requestAnimationFrame(focusNewRow);
        }
      };
      requestAnimationFrame(focusNewRow);
      return true;
    }

    focusTableCell(cells[targetIndex]);
    return true;
  }

  // The stable ids of every block the current selection touches, top to bottom.
  // A collapsed caret yields the single block it sits in; a drag across blocks
  // yields all of them — so formatting can apply to a whole multi-block range.
  function selectedCanvasBlockIds(): string[] {
    const canvas = canvasRef.current;
    if (!canvas) return [];

    // A drag ACROSS blocks uses the editor's own selection (pendingSelectionDraft)
    // and clears the native selection, so window.getSelection() is empty for it.
    // Map the draft's source range to every block it covers. (A single-block drag
    // keeps the native selection and falls through to the logic below.)
    if (pendingSelectionDraft) {
      const markdown = markdownForSelection();
      const draftRange = resolveSelectionDraftRange(markdown, pendingSelectionDraft);
      if (draftRange && draftRange.end > draftRange.start) {
        const spans = getMarkdownBlockLineSpans(markdown);
        const ids = blocksForMarkdown(markdown).flatMap((block, index) => {
          const span = spans[index];
          const covered = span && !(draftRange.end <= span.textStart || draftRange.start >= span.textEnd);
          return covered ? [block.id] : [];
        });
        if (ids.length > 0) return ids;
      }
    }

    const selection = window.getSelection();
    const liveRange =
      selection && selection.rangeCount > 0 && canvas.contains(selection.getRangeAt(0).commonAncestorContainer)
        ? selection.getRangeAt(0)
        : null;
    const range = liveRange ?? selectionRangeRef.current;
    if (!range || !canvas.contains(range.commonAncestorContainer)) return [];
    const all = Array.from(canvas.querySelectorAll<HTMLElement>("[data-block-id]"));
    if (all.length === 0) return [];

    // Map an arbitrary selection node to the index of the block it belongs to —
    // directly when it's inside the editable, or via its block wrapper when an
    // endpoint lands on a non-editable part (a list-row marker span, a quote/code
    // wrapper). Returns -1 for container/boundary nodes.
    const indexOfNode = (node: Node | null): number => {
      if (!node) return -1;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (!element) return -1;
      const direct = element.closest("[data-block-id]");
      if (direct) return all.indexOf(direct as HTMLElement);
      const wrapper = element.closest(".editable-list-row, blockquote, pre, figure");
      const inside = wrapper?.querySelector("[data-block-id]");
      return inside ? all.indexOf(inside as HTMLElement) : -1;
    };

    // Gather every signal of the selection's extent and take the widest span.
    // A drag across separate contentEditable blocks is reported inconsistently:
    // getRangeAt() may stay confined to one block while the selection's logical
    // anchor/focus span several, and either endpoint can land on a non-editable
    // boundary node. Combining range endpoints, anchor/focus, and geometric
    // intersection keeps a multi-block selection from collapsing to one block.
    const indices: number[] = [];
    const pushIndex = (node: Node | null) => {
      const index = indexOfNode(node);
      if (index >= 0) indices.push(index);
    };
    pushIndex(range.startContainer);
    pushIndex(range.endContainer);
    if (liveRange && selection) {
      pushIndex(selection.anchorNode);
      pushIndex(selection.focusNode);
    }
    all.forEach((node, index) => {
      if (range.intersectsNode(node)) indices.push(index);
    });
    if (indices.length === 0) return [];

    const lo = Math.min(...indices);
    const hi = Math.max(...indices);
    return all
      .slice(lo, hi + 1)
      .map((node) => node.dataset.blockId)
      .filter((id): id is string => Boolean(id));
  }


  // Apply a block-shape change (heading / list / quote / paragraph) to every
  // selected text block at once. Serializes the live DOM first so in-progress
  // edits are captured, then remounts so the new shapes paint immediately.
  function updateSelectedBlocksShape(blockIds: string[], patch: Parameters<typeof updateMarkdownBlockShape>[2]) {
    const current = stateRef.current;
    if (!current || blockIds.length === 0) return;
    const selected = new Set(blockIds);
    const nextBlocks = blocksForMarkdown(serializeCanvasMarkdown(current.markdown)).map((block) =>
      selected.has(block.id) && isShapeConvertibleType(block.type) ? { ...block, ...patch } : block
    );
    const markdown = serializeMarkdownBlocks(nextBlocks);
    commit(
      () => ({ ...current, markdown, review: { ...current.review, updatedAt: nowIso() } }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    const focusId = activeBlockId && selected.has(activeBlockId) ? activeBlockId : blockIds[0];
    const focusIndex = nextBlocks.findIndex((block) => block.id === focusId);
    if (focusIndex >= 0) {
      pendingCaretRef.current = { index: focusIndex, offset: 0 };
      schedulePendingCaretFlush();
    }
  }

  // Route a shape change to the whole selection when it spans several blocks,
  // otherwise to the single block (the caret's block, or the given fallback).
  function changeBlockShape(patch: Parameters<typeof updateMarkdownBlockShape>[2], fallbackId?: string | null) {
    const ids = selectedCanvasBlockIds();
    if (ids.length > 1) {
      updateSelectedBlocksShape(ids, patch);
      return;
    }
    const single = ids[0] ?? fallbackId ?? activeBlockId;
    if (single) updateBlockShape(single, patch);
  }

  function updateActiveBlockShape(patch: Parameters<typeof updateMarkdownBlockShape>[2]) {
    changeBlockShape(patch, activeBlockId);
  }

  function applyInlineCommand(command: "bold" | "italic" | "strikeThrough") {
    restoreCanvasSelection();
    // Emit semantic tags (<strong>/<em>/<s>) rather than inline styles so the
    // formatting survives serialization back to Markdown.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command);
    rememberCanvasSelection();
    scheduleLiveCanvasCommit();
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
    scheduleLiveCanvasCommit();
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

  // Place the caret into the block targeted by pendingCaretRef. Returns true once
  // that block holds focus (or there is nothing pending); a no-op while it already
  // holds focus, so it never fights active typing.
  function applyPendingCaret() {
    const pending = pendingCaretRef.current;
    if (!pending) return true;
    const target = reconciledBlocksRef.current[pending.index];
    if (!target) return false;
    const node = blockRefs.current[target.id];
    if (!node) return false;
    if (node === document.activeElement || node.contains(document.activeElement)) return true;
    setActiveBlockId(target.id);
    placeCaretInEditableBlock(node, pending.offset);
    return node === document.activeElement || node.contains(document.activeElement);
  }

  // A structural commit remounts blocks and blurs the old focus; placing the caret
  // into a freshly-rendered (often empty) block can take a frame or two to stick,
  // so re-apply it across several animation frames until it holds or the writer
  // types (scheduleLiveCanvasCommit clears the pending request).
  function schedulePendingCaretFlush(attempts = 24) {
    if (!pendingCaretRef.current) return;
    if (attempts <= 0) {
      // The self-heal window (covering the post-commit save re-render) has
      // elapsed and the caret has settled. Clear the request so the on-blur
      // commit isn't skipped forever: otherwise creating an empty block and then
      // leaving the editor without typing would keep the pending guard set, and
      // the empty placeholder would never be dropped from the saved Markdown.
      pendingCaretRef.current = null;
      return;
    }
    applyPendingCaret();
    window.requestAnimationFrame(() => schedulePendingCaretFlush(attempts - 1));
  }

  // Pressing Enter splits the current block at the caret into a new block right
  // away. The caret is located by inserting a private-use sentinel and serializing
  // the WHOLE canvas, so the split point is found by its exact position in the
  // resulting markdown — correct even when one DOM block holds several logical
  // blocks (the bug that an id-based split hit). A heading/quote continuation
  // becomes a paragraph; an empty side is kept (lists via "- ", others via a
  // zero-width space) so the new block survives the round-trip.
  function splitBlockAtCaret() {
    const current = stateRef.current;
    const selection = window.getSelection();
    if (!current || !selection || selection.rangeCount === 0 || !canvasRef.current) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !canvasRef.current.contains(range.startContainer)) return false;

    const sentinel = "\ue000";
    const marker = document.createTextNode(sentinel);
    range.insertNode(marker);
    let raw: string;
    try {
      raw = serializeCanvasMarkdown(current.markdown);
    } finally {
      marker.remove();
    }
    if (!raw.includes(sentinel)) return false;

    const parsed = parseMarkdownBlocks(raw);
    const splitIndex = parsed.findIndex((block) => block.text.includes(sentinel));
    if (splitIndex < 0) return false;
    const target = parsed[splitIndex];
    const at = target.text.indexOf(sentinel);
    const before = target.text.slice(0, at);
    const after = target.text.slice(at + sentinel.length);

    const cleaned = parsed.map((block) => ({ ...block, text: block.text.split(sentinel).join("") }));
    // An empty side is kept via a zero-width space so the new block survives
    // re-parsing and renders a focusable <br> line.
    const emptyMarker = "\u200b";
    const targetIsList = target.type === "ordered-list" || target.type === "unordered-list";
    const targetIsEmpty = (before + after).replace(/\u200b/g, "").trim() === "";

    let nextBlocks: ReturnType<typeof parseMarkdownBlocks>;
    let caretIndex: number;
    if (targetIsList && targetIsEmpty) {
      // Enter on an empty list item exits the list: turn the item into an empty
      // paragraph (which lands below the list) instead of adding another bullet.
      nextBlocks = cleaned.map((block, index) =>
        index === splitIndex
          ? { ...block, type: "paragraph", level: undefined, marker: undefined, text: emptyMarker }
          : block
      );
      caretIndex = splitIndex;
    } else {
      // A heading/quote continues as a paragraph; other types continue as themselves.
      const afterType = target.type === "heading" || target.type === "quote" ? "paragraph" : target.type;
      const beforeBlock = { ...cleaned[splitIndex], text: before || emptyMarker };
      const afterBlock =
        afterType === target.type
          ? { ...cleaned[splitIndex], text: after || emptyMarker }
          : { ...cleaned[splitIndex], type: afterType, level: undefined, marker: undefined, text: after || emptyMarker };
      nextBlocks = [...cleaned.slice(0, splitIndex), beforeBlock, afterBlock, ...cleaned.slice(splitIndex + 1)];
      caretIndex = splitIndex + 1;
    }
    const markdown = serializeMarkdownBlocks(nextBlocks);

    commit(
      () => ({ ...current, markdown, review: { ...current.review, updatedAt: nowIso() } }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: caretIndex, offset: 0 };
    schedulePendingCaretFlush();
    return true;
  }

  // Markdown input rule: typing a block prefix at the very start of a paragraph
  // ("1. ", "- ", "* ", "# "…"###### ", "> ") turns it into that block right away.
  // Called on the space keypress (before the space is inserted); returns true when
  // it converts, so the caller consumes the space. The caret block is found with the
  // same whole-canvas sentinel as splitBlockAtCaret, so "start of paragraph" is
  // correct even when one DOM shell holds several logical blocks.
  function applyTypeInputRule() {
    const current = stateRef.current;
    const selection = window.getSelection();
    if (!current || !selection || selection.rangeCount === 0 || !canvasRef.current) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !canvasRef.current.contains(range.startContainer)) return false;

    // Cheap pre-check so the whole-canvas serialize below only runs when the caret
    // could actually sit right after a block prefix ("1." / "-" / "*" / "#" / ">" /
    // a task box "[ ]" ending in "]").
    const prevChar =
      range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0
        ? range.startContainer.textContent?.[range.startOffset - 1]
        : "";
    if (!prevChar || !".-*#>]".includes(prevChar)) return false;

    const sentinel = "\ue000";
    const marker = document.createTextNode(sentinel);
    range.insertNode(marker);
    let raw: string;
    try {
      raw = serializeCanvasMarkdown(current.markdown);
    } finally {
      marker.remove();
    }
    if (!raw.includes(sentinel)) return false;

    const parsed = parseMarkdownBlocks(raw);
    const index = parsed.findIndex((block) => block.text.includes(sentinel));
    if (index < 0) return false;
    const target = parsed[index];
    const at = target.text.indexOf(sentinel);
    const before = target.text.slice(0, at).replace(/\u200b/g, "");
    const after = target.text.slice(at + sentinel.length).replace(/\u200b/g, "");

    // The ordered/unordered/heading prefixes only match when the block is still a
    // paragraph (their markers don't parse as a block without the trailing space
    // the writer is about to type).
    const isParagraph = target.type === "paragraph";
    const ordered = isParagraph ? before.match(/^(\d+)\.$/) : null;
    const heading = isParagraph ? before.match(/^(#{1,6})$/) : null;
    const unordered = isParagraph && /^[-*]$/.test(before);
    // ">" needs no trailing space to parse as a quote, so parseMarkdownBlocks has
    // already produced a quote block with the caret at its start; the rule just
    // consumes the triggering space and re-commits it as a real quote.
    const quote = prevChar === ">" && target.type === "quote" && before === "";
    // "[ ]" / "[x]" (empty brackets allowed) makes a task-list item, from either a
    // paragraph or the empty text of a bullet just created by the "- " rule.
    const task =
      prevChar === "]" && (isParagraph || target.type === "unordered-list")
        ? before.match(/^\[([ xX]?)\]$/)
        : null;

    if (!ordered && !heading && !unordered && !quote && !task) return false;

    const cleaned = parsed.map((block) => ({ ...block, text: block.text.split(sentinel).join("") }));
    const nextText = after || "\u200b";
    let converted: (typeof parsed)[number];
    if (ordered) {
      converted = { ...cleaned[index], type: "ordered-list", marker: ordered[1], level: undefined, text: nextText };
    } else if (heading) {
      converted = { ...cleaned[index], type: "heading", marker: undefined, level: heading[1].length, text: nextText };
    } else if (task) {
      converted = { ...cleaned[index], type: "unordered-list", marker: undefined, level: undefined, checked: task[1].toLowerCase() === "x", text: nextText };
    } else if (unordered) {
      converted = { ...cleaned[index], type: "unordered-list", marker: undefined, level: undefined, text: nextText };
    } else if (quote) {
      converted = { ...cleaned[index], type: "quote", marker: undefined, level: undefined, text: nextText };
    } else {
      return false;
    }
    const nextBlocks = [...cleaned.slice(0, index), converted, ...cleaned.slice(index + 1)];
    const markdown = serializeMarkdownBlocks(nextBlocks);

    commit(
      () => ({ ...current, markdown, review: { ...current.review, updatedAt: nowIso() } }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index, offset: 0 };
    schedulePendingCaretFlush();
    return true;
  }

  // Enter input rule: a paragraph whose whole line is a ``` fence (optionally with
  // a language) becomes an empty fenced code block with the caret inside.
  //
  // It rebuilds from the on-screen block structure (reconciledBlocksRef) + live DOM
  // text, NOT from a reparse of stateRef.markdown: once the 1200ms live-save debounce
  // has run, the model already contains a bare ``` line that reparses into an
  // unclosed fence swallowing the following blocks. The rendered blocks stay intact
  // through that save (renderSavedState:false), so they are the reliable source.
  function applyCodeFenceInputRule(blockId: string) {
    const current = stateRef.current;
    const node = blockRefs.current[blockId];
    if (!current || !node) return false;

    const rendered = reconciledBlocksRef.current.length
      ? reconciledBlocksRef.current
      : [{ id: blockId, type: "paragraph" as const, text: "" }];
    const target = rendered.find((block) => block.id === blockId);
    // Only a bare-fence paragraph converts; a real code/table/etc. block bails so
    // its own Enter handling (newline / swallow) still runs.
    if (target && target.type !== "paragraph") return false;
    const fence = blockNodeToMarkdown(node, "paragraph").replace(/​/g, "").trim().match(/^```(\w*)$/);
    if (!fence) return false;
    const language = fence[1] || undefined;

    const blocks = rendered.flatMap((block) => {
      if (block.id === blockId) {
        return [{ ...block, type: "code" as const, language, level: undefined, marker: undefined, checked: undefined, text: "​" }];
      }
      if (isVoidBlockType(block.type)) return [block];
      const domNode = blockRefs.current[block.id];
      if (!domNode) return [block];
      const text = blockNodeToMarkdown(domNode, block.type);
      return text.trim() ? [{ ...block, text }] : [];
    });
    const markdown = serializeMarkdownBlocks(blocks);

    commit(
      () => ({ ...current, markdown, review: { ...current.review, updatedAt: nowIso() } }),
      { resyncDom: true }
    );

    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: Math.max(0, blocks.findIndex((block) => block.id === blockId)), offset: 0 };
    schedulePendingCaretFlush();
    return true;
  }

  // Enter input rule: a paragraph whose whole line is a --- / *** / ___ rule becomes
  // a horizontal-rule block followed by an empty paragraph for the caret.
  function applyThematicBreakInputRule(blockId: string) {
    const current = stateRef.current;
    const node = blockRefs.current[blockId];
    if (!current || !node) return false;
    const target = findBlockById(current.markdown, blockId);
    if (target && target.type !== "paragraph") return false;
    if (!isThematicBreak(blockNodeToMarkdown(node, "paragraph").replace(/​/g, ""))) return false;

    const liveState = stateWithLiveCanvasEdit(current);
    const blocks = blocksForMarkdown(liveState.markdown);
    const index = blocks.findIndex((block) => block.id === blockId);
    const before = index >= 0 ? blocks.slice(0, index) : [];
    const after = index >= 0 ? blocks.slice(index + 1) : [];
    const nextBlocks = [
      ...before,
      { id: blockId, type: "thematic-break" as const, text: "" },
      { id: `${blockId}-after`, type: "paragraph" as const, text: "​" },
      ...after
    ];
    commit(
      () => ({
        ...liveState,
        markdown: serializeMarkdownBlocks(nextBlocks),
        review: { ...liveState.review, updatedAt: nowIso() }
      }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: (index >= 0 ? index : 0) + 1, offset: 0 };
    schedulePendingCaretFlush();
    return true;
  }

  // Backspace at the very start of a block merges it into the previous block and
  // puts the caret at the join (the end of the previous block's text) — so an
  // empty block is removed and a non-empty one's text is appended. The caret is
  // located by the same whole-canvas sentinel as splitBlockAtCaret, so "start of
  // block" is correct even when one DOM shell holds several logical blocks.
  // Returns false (letting the default Backspace delete a character) unless the
  // caret is at the start of a block that has a text-holding block before it.
  function mergeBlockBackward() {
    const current = stateRef.current;
    const selection = window.getSelection();
    if (!current || !selection || selection.rangeCount === 0 || !canvasRef.current) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !canvasRef.current.contains(range.startContainer)) return false;

    const sentinel = "\ue000";
    const marker = document.createTextNode(sentinel);
    range.insertNode(marker);
    let raw: string;
    try {
      raw = serializeCanvasMarkdown(current.markdown);
    } finally {
      marker.remove();
    }
    if (!raw.includes(sentinel)) return false;

    const parsed = parseMarkdownBlocks(raw);
    const index = parsed.findIndex((block) => block.text.includes(sentinel));
    if (index <= 0) return false;
    const target = parsed[index];
    // Only act when nothing but the caret precedes the block's content.
    if (target.text.slice(0, target.text.indexOf(sentinel)).replace(/\u200b/g, "").length > 0) return false;

    const cleaned = parsed.map((block) => ({ ...block, text: block.text.split(sentinel).join("") }));
    const previous = cleaned[index - 1];
    const previousHoldsText =
      previous.type === "paragraph" ||
      previous.type === "heading" ||
      previous.type === "quote" ||
      previous.type === "ordered-list" ||
      previous.type === "unordered-list";
    if (!previousHoldsText) return false;

    const previousText = previous.text.replace(/\u200b/g, "");
    const currentText = cleaned[index].text.replace(/\u200b/g, "");
    const mergedPrevious = { ...previous, text: previousText + currentText };
    const nextBlocks = [...cleaned.slice(0, index - 1), mergedPrevious, ...cleaned.slice(index + 1)];
    const markdown = serializeMarkdownBlocks(nextBlocks);

    commit(
      () => ({ ...current, markdown, review: { ...current.review, updatedAt: nowIso() } }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: index - 1, offset: visibleMarkdownCharacters(previousText).length };
    schedulePendingCaretFlush();
    return true;
  }

  // Insert an empty paragraph immediately after a block and move the caret into
  // it — used so image blocks (which can't hold a caret) aren't a dead end.
  function insertParagraphAfterBlock(blockId: string) {
    const current = stateRef.current;
    if (!current) return false;
    const liveState = stateWithLiveCanvasEdit(current);
    const blocks = blocksForMarkdown(liveState.markdown);
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return false;

    const nextBlocks = [
      ...blocks.slice(0, index + 1),
      { id: `${blockId}-after`, type: "paragraph" as const, text: "\u200b" },
      ...blocks.slice(index + 1)
    ];
    commit(
      () => ({
        ...liveState,
        markdown: serializeMarkdownBlocks(nextBlocks),
        review: { ...liveState.review, updatedAt: nowIso() }
      }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: index + 1, offset: 0 };
    schedulePendingCaretFlush();
    return true;
  }

  // Insert a horizontal rule after the given block, plus an empty paragraph below
  // it so the caret has somewhere to land (the rule itself is a void block).
  function insertThematicBreakAfterBlock(blockId: string) {
    const current = stateRef.current;
    if (!current) return false;
    const liveState = stateWithLiveCanvasEdit(current);
    const blocks = blocksForMarkdown(liveState.markdown);
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return false;

    const nextBlocks = [
      ...blocks.slice(0, index + 1),
      { id: `${blockId}-hr`, type: "thematic-break" as const, text: "" },
      { id: `${blockId}-hr-after`, type: "paragraph" as const, text: "​" },
      ...blocks.slice(index + 1)
    ];
    commit(
      () => ({
        ...liveState,
        markdown: serializeMarkdownBlocks(nextBlocks),
        review: { ...liveState.review, updatedAt: nowIso() }
      }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: index + 2, offset: 0 };
    schedulePendingCaretFlush();
    return true;
  }

  // Insert a starter 2×2 table after the given block and drop the caret into it.
  function insertTableAfterBlock(blockId: string) {
    const current = stateRef.current;
    if (!current) return false;
    const liveState = stateWithLiveCanvasEdit(current);
    const blocks = blocksForMarkdown(liveState.markdown);
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return false;

    const tableText = "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |";
    const nextBlocks = [
      ...blocks.slice(0, index + 1),
      { id: `${blockId}-table`, type: "table" as const, text: tableText },
      ...blocks.slice(index + 1)
    ];
    commit(
      () => ({
        ...liveState,
        markdown: serializeMarkdownBlocks(nextBlocks),
        review: { ...liveState.review, updatedAt: nowIso() }
      }),
      { resyncDom: true }
    );
    if (liveEditTimerRef.current) {
      window.clearTimeout(liveEditTimerRef.current);
      liveEditTimerRef.current = null;
    }
    liveEditHistoryActiveRef.current = false;
    pendingCaretRef.current = { index: index + 1, offset: 0 };
    schedulePendingCaretFlush();
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
        stateRef.current ? findBlockById(stateRef.current.markdown, blockId)?.type : undefined
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
      const block = findBlockById(currentState.markdown, target.blockId);
      const linkedText = block ? applyMarkdownLinkToSelection(block.text, target, href) : null;
      if (block && linkedText && linkedText !== block.text) {
        commit(
          (state) => ({
            ...state,
            markdown: updateMarkdownBlock(state.markdown, positionalBlockId(state.markdown, target.blockId), linkedText),
            review: {
              ...state.review,
              updatedAt: nowIso()
            }
          }),
          { resyncDom: true }
        );

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

    // Void blocks (images, horizontal rules) can't hold a caret, so give them
    // keyboard escapes: Enter adds a paragraph after, Backspace/Delete removes the
    // block. Other keys fall through (so Cmd+Z etc. still work).
    if (!isCommand && isVoidBlockType((stateRef.current ? findBlockById(stateRef.current.markdown, blockId)?.type : null) ?? "")) {
      if (event.key === "Enter") {
        event.preventDefault();
        insertParagraphAfterBlock(blockId);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteCanvasBlock(blockId);
        return;
      }
    }

    // Tab / Shift+Tab move between cells inside a table (Tab past the last cell adds
    // a row). Only handled while the caret is actually in a table cell; otherwise it
    // falls through to the browser's default focus movement.
    if (!isCommand && event.key === "Tab") {
      const type = stateRef.current ? findBlockById(stateRef.current.markdown, blockId)?.type : null;
      if (type === "table" && moveTableCell(blockId, event.shiftKey)) {
        event.preventDefault();
        return;
      }
    }

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

    // Backspace at the very start of a block merges it into the previous block
    // (removing an empty block; appending a non-empty one's text). When the caret
    // isn't at a block start, mergeBlockBackward returns false and the default
    // Backspace deletes a character as usual.
    if (
      event.key === "Backspace" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      if (mergeBlockBackward()) {
        event.preventDefault();
        return;
      }
    }

    // Typing a block prefix ("1. ", "- ", "* ", "# ", "> ") at the start of a
    // paragraph turns it into that block; the space that triggers the rule is
    // consumed.
    if (
      event.key === " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      if (applyTypeInputRule()) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.nativeEvent.isComposing) {
      const currentBlock = stateRef.current ? findBlockById(stateRef.current.markdown, blockId) : null;
      event.preventDefault();
      setActiveBlockId(blockId);
      const type = currentBlock?.type;

      // Shift+Enter is a soft line break within the current block.
      if (event.shiftKey) {
        insertEditorBreak(false);
        rememberCanvasSelection();
        return;
      }

      // Typing ``` (optionally with a language) on its own line and pressing Enter
      // opens an empty fenced code block. This runs BEFORE the code/table branches:
      // once the live-save debounce has reparsed the bare fence into an unclosed
      // code block, `type` is already "code", so the newline path below would win
      // and leave the fence unclosed (swallowing following blocks) if this ran later.
      if (applyCodeFenceInputRule(blockId)) return;

      // A table cell can't hold a line break (it collapses to a space on
      // serialize), so swallow Enter rather than insert a break that vanishes.
      if (type === "table") {
        rememberCanvasSelection();
        return;
      }

      // Code keeps Enter as a literal newline so multi-line code stays editable.
      if (type === "code") {
        insertEditorBreak(false);
        rememberCanvasSelection();
        return;
      }

      // Typing ---, *** or ___ on its own line and pressing Enter inserts a
      // horizontal rule and drops the caret into a fresh paragraph below it.
      if (applyThematicBreakInputRule(blockId)) return;

      // Every other block splits at the caret into a new block immediately.
      if (splitBlockAtCaret()) return;
      // Fallback if the caret can't be resolved: a paragraph break.
      insertEditorBreak(true);
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
    if (event.shiftKey && key === "x") {
      event.preventDefault();
      applyInlineCommand("strikeThrough");
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
    if (event.altKey && ["0", "1", "2", "3", "4", "5", "6"].includes(key)) {
      event.preventDefault();
      setActiveBlockId(blockId);
      if (key === "0") changeBlockShape({ type: "paragraph", level: undefined }, blockId);
      else changeBlockShape({ type: "heading", level: Number(key) }, blockId);
      return;
    }
    if (event.altKey && key === "c") {
      event.preventDefault();
      setActiveBlockId(blockId);
      changeBlockShape({ type: "code", level: undefined, marker: undefined }, blockId);
      return;
    }
    if (event.shiftKey && key === "7") {
      event.preventDefault();
      setActiveBlockId(blockId);
      changeBlockShape({ type: "ordered-list", marker: "1" }, blockId);
      return;
    }
    if (event.shiftKey && key === "8") {
      event.preventDefault();
      setActiveBlockId(blockId);
      changeBlockShape({ type: "unordered-list" }, blockId);
      return;
    }
    // Ctrl/Cmd+Shift+. — the "." key reports as ">" under Shift on many layouts,
    // so accept either.
    if (event.shiftKey && (key === "." || key === ">")) {
      event.preventDefault();
      setActiveBlockId(blockId);
      changeBlockShape({ type: "quote" }, blockId);
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
  }, [setLastCopied]);

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
    }), { resyncDom: true });
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
      if (restoreEpoch === stateEpochRef.current) {
        stateRef.current = restored.document;
        // Restoring a revision swaps the whole document out-of-band; remount the
        // editable blocks so the canvas shows the restored content immediately.
        resetRenderedEditableBlocks(restored.document.markdown);
        setDocumentState(restored.document);
        setRevisionState(restored.revisions);
        setActiveThreadId(null);
        setSelectionDraft(null);
        setPendingSelectionDraft(null);
        selectionRangeRef.current = null;
        setFloatingToolbar(null);
        window.getSelection()?.removeAllRanges();
        setSaveState("saved");
      }
    } catch {
      setSaveState("error");
    } finally {
      setIsRestoringRevision(false);
    }
  }

  const editorLanguage = appSettings.editorLanguage;
  const configuredRuntime = currentConfiguredRuntime();
  const resolvedRuntime =
    agentRuntimeConfig?.resolvedRuntime ?? (configuredRuntime === "auto" ? agentSession?.runtime ?? null : configuredRuntime);
  const configuredModel = currentConfiguredModel();
  const configuredEffort = currentConfiguredEffort();
  const runtimeOptions = agentRuntimeConfig?.runtimes ?? [];
  const providerOptions = runtimeOptions.filter((runtime) => runtime.id !== "stub");
  const hasAvailableAgentRuntime = providerOptions.some((runtime) => runtime.available);
  const agentRuntimeUnavailable = Boolean(agentRuntimeConfig && providerOptions.length > 0 && !hasAvailableAgentRuntime);
  const effectiveRuntime = effectiveRuntimeId(configuredRuntime, resolvedRuntime);
  const providerSelectValue = resolveProviderSelectValue(configuredRuntime, resolvedRuntime, providerOptions);
  const selectedRuntimeStatus = runtimeOptions.find((runtime) => runtime.id === effectiveRuntime) ?? null;
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
    : agentRuntimeUnavailable
      ? AGENT_RUNTIME_UNAVAILABLE_TITLE
      : configuredRuntime === "auto"
        ? "Auto picks the first healthy agent runtime from your configured priority."
        : "Agent runtime";
  const selectedRuntimeLabel = selectedRuntimeDisplayLabel({
    agentRuntimeUnavailable,
    configuredRuntime,
    runtimeLabel: selectedRuntimeStatus?.label ?? resolvedRuntime
  });
  const selectedModelOption = modelOptions.find((model) => model.id === configuredModel);
  const selectedModelLabel = configuredModel === "auto" ? "Default model" : selectedModelOption?.label ?? configuredModel;
  const selectedEffortOption = effortOptions.find((level) => level.id === configuredEffort);
  const selectedEffortLabel =
    configuredEffort === "auto" ? "Default effort" : selectedEffortOption?.label ?? configuredEffort;
  const agentStatusLabel = agentSession
    ? `${agentSession.status}${agentSession.queueDepth > 0 ? ` · ${agentSession.queueDepth}` : ""}`
    : "idle";


  return {
    documentState,
    appSettings,
    settingsDraft,
    isSettingsOpen,
    firstRunStep,
    toneSetupInvocation,
    settingsSaveState,
    revisionState,
    agentSkills,
    agentRuntimeConfig,
    agentModelDraft,
    isAgentConfigOpen,
    isAgentModelMenuOpen,
    saveState,
    panelMode,
    activeThreadId,
    activeBlockId,
    isLeftRailCollapsed,
    isRightPanelCollapsed,
    isRestoringRevision,
    isRevisionHistoryOpen,
    selectionDraft,
    pendingSelectionDraft,
    newComment,
    replyDrafts,
    newThreadSkillIds,
    threadSkillIds,
    chatDraft,
    chatSkillIds,
    floatingToolbar,
    linkPopover,
    selectionContextMenu,
    linkDraft,
    lastCopied,
    blockResetKeys,
    blocks: reconciledBlocks,
    agentSession,
    agentRuntimeUnavailable,
    isFlowMode,
    setIsFlowMode,
    canvasRef,
    fileInputRef,
    imageInputRef,
    linkInputRef,
    selectionRangeRef,
    linkRangeRef,
    linkTargetRef,
    setIsAgentConfigOpen,
    setIsAgentModelMenuOpen,
    setAgentModelDraft,
    setIsLeftRailCollapsed,
    setIsRightPanelCollapsed,
    setIsRevisionHistoryOpen,
    setPanelMode,
    setNewComment,
    setNewThreadSkillIds,
    setSelectionDraft,
    setPendingSelectionDraft,
    setFloatingToolbar,
    setReplyDrafts,
    setThreadSkillIds,
    setChatDraft,
    setChatSkillIds,
    setLinkPopover,
    setLinkDraft,
    setToneSetupInvocation,
    setSelectionContextMenu,
    outline,
    words,
    threads,
    showResolvedThreads,
    visibleThreads,
    proposals,
    reviewableProposals,
    activeInlineProposal,
    contextLedger,
    activeThread,
    openThreadCount,
    resolvedThreadCount,
    editorLanguage,
    configuredRuntime,
    resolvedRuntime,
    configuredModel,
    configuredEffort,
    runtimeOptions,
    providerOptions,
    providerSelectValue,
    selectedRuntimeStatus,
    modelOptions,
    effortOptions,
    effortSelectValue,
    agentConfigDisabled,
    modelControlDisabled,
    effortControlVisible,
    agentRuntimeTitle,
    selectedRuntimeLabel,
    selectedModelOption,
    selectedModelLabel,
    selectedEffortOption,
    selectedEffortLabel,
    agentStatusLabel,
    updateAgentRuntime,
    commitAgentModel,
    selectAgentModel,
    updateAgentEffort,
    refreshAgentRuntimes,
    persistSettings,
    updateSettingsDraft,
    saveSettingsDraft,
    toneSettingsBase,
    saveToneOfVoiceSetup,
    skipToneOfVoiceSetup,
    continueFirstRunAgentSetup,
    skipFirstRunAgentSetup,
    updatePanelState,
    restoreRevision,
    updateActiveBlockShape,
    insertThematicBreakAfterBlock,
    insertTableAfterBlock,
    toggleTaskListItem,
    editTable,
    applyInlineCommand,
    applyInlineCode,
    openLinkPopover,
    startCommentFromSelection,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleCanvasPointerCancel,
    handleCanvasKeyDown,
    handleCanvasSelectionEvent,
    handleCanvasCopy,
    handleCanvasCut,
    handleCanvasPaste,
    handleCanvasDrop,
    handleCanvasContextMenu,
    updateFloatingToolbarPosition,
    updateProposalStatus,
    requestProposalRewrite,
    activateThread,
    updateCanvasBlock,
    registerBlockRef,
    focusCanvasBlock,
    rememberCanvasSelection,
    handleEditorShortcut,
    commitCanvasDom,
    scheduleLiveCanvasCommit,
    moveCanvasBlock,
    deleteCanvasBlock,
    updateProposalChangeDecision,
    requestProposalRevision,
    notifyTableImageExported,
    addThread,
    addThreadMessage,
    requestThreadAgentReply,
    updateThreadStatus,
    updateSuggestionStatus,
    addChatMessage,
    applyLink,
    copyActiveSelectionToClipboard,
    cutActiveSelectionToClipboard,
    pasteClipboardFromMenu,
    copyText,
    exportMarkdown,
    importMarkdown,
    insertImageFiles,
    openSettingsDialog,
    cancelSettingsDialog
  };
}

type SkribeController = ReturnType<typeof useSkribeController>;

const SkribeControllerContext = React.createContext<SkribeController | null>(null);

function useSkribeControllerContext() {
  const controller = use(SkribeControllerContext);
  if (!controller) throw new Error("Skribe controller context is missing");
  return controller;
}

function App() {
  const controller = useSkribeController();
  return (
    <SkribeControllerContext.Provider value={controller}>
      <SkribeView />
    </SkribeControllerContext.Provider>
  );
}

function SkribeView() {
  const { documentState } = useSkribeControllerContext();
  if (!documentState) return <SkribeLoadingScreen />;
  return <SkribeShell />;
}

function SkribeLoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="loading-mark" />
      <p>Opening local writing workspace...</p>
    </main>
  );
}

function SkribeShell() {
  const {
    appSettings,
    documentState,
    editorLanguage,
    isFlowMode,
    isLeftRailCollapsed,
    isRightPanelCollapsed,
    lastCopied,
    setIsFlowMode
  } = useSkribeControllerContext();

  useEffect(() => {
    if (!isFlowMode) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsFlowMode(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFlowMode, setIsFlowMode]);

  if (!documentState) return <SkribeLoadingScreen />;

  return (
    <main
      className={`app-shell ${isFlowMode ? "flow-mode" : ""} ${isLeftRailCollapsed ? "left-collapsed" : ""} ${
        isRightPanelCollapsed ? "right-collapsed" : ""
      }`}
      data-theme={appSettings.theme}
      data-document-font={appSettings.documentFont}
      lang={editorLanguage}
    >
      {isFlowMode ? null : <Topbar />}
      <section className="workspace">
        {isFlowMode ? null : <LeftRail />}
        <CenterPane />
        {isFlowMode ? null : <RightPanel />}
      </section>
      {isFlowMode ? (
        <button
          type="button"
          className="flow-mode-toggle"
          onClick={() => setIsFlowMode(false)}
          title="Exit flow mode"
          aria-label="Exit flow mode"
        >
          <Eye size={16} />
          <span>Exit Flow</span>
        </button>
      ) : null}
      <SkribeOverlays />
      {lastCopied ? <div className="toast">{lastCopied}</div> : null}
    </main>
  );
}

function Topbar() {
  const {
    documentState,
    fileInputRef,
    imageInputRef,
    saveState,
    copyText,
    exportMarkdown,
    importMarkdown,
    insertImageFiles,
    openSettingsDialog,
    setIsFlowMode
  } = useSkribeControllerContext();

  if (!documentState) return null;

  return (
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
        <AgentConfigControl />
        <span className={`save-pill is-${saveState}`}>
          {saveState === "saving" ? <RefreshCw size={14} /> : <Save size={14} />}
          {saveState}
        </span>
        <button type="button" className="icon-button" onClick={openSettingsDialog} title="Settings" aria-label="Settings">
          <Settings size={17} />
        </button>
        <button type="button" className="icon-button" onClick={() => setIsFlowMode(true)} title="Flow mode" aria-label="Enter flow mode">
          <EyeOff size={17} />
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
  );
}

function AgentConfigControl() {
  const {
    agentConfigDisabled,
    agentModelDraft,
    agentRuntimeTitle,
    agentRuntimeUnavailable,
    agentSession,
    agentStatusLabel,
    configuredModel,
    effortControlVisible,
    effortOptions,
    effortSelectValue,
    isAgentConfigOpen,
    isAgentModelMenuOpen,
    modelControlDisabled,
    modelOptions,
    providerOptions,
    providerSelectValue,
    selectedEffortLabel,
    selectedModelLabel,
    selectedRuntimeLabel,
    selectedRuntimeStatus,
    commitAgentModel,
    selectAgentModel,
    setAgentModelDraft,
    setIsAgentConfigOpen,
    setIsAgentModelMenuOpen,
    updateAgentEffort,
    updateAgentRuntime,
    refreshAgentRuntimes
  } = useSkribeControllerContext();

  return (
    <div className={`agent-config-shell ${isAgentConfigOpen ? "is-open" : ""} ${agentRuntimeUnavailable ? "is-unavailable" : ""}`}>
      <button
        type="button"
        className={`agent-config-button is-${agentSession?.status ?? "idle"}`}
        onClick={() => {
          setIsAgentConfigOpen((open) => {
            const nextOpen = !open;
            if (nextOpen) void refreshAgentRuntimes();
            return nextOpen;
          });
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
                <option value="auto">Auto</option>
                {providerSelectValue === "" ? <option value="">No runtime detected</option> : null}
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
                  ? "Agent model. Use Default model to let the selected runtime choose."
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
                <menu className="agent-model-menu">
                  <button
                    type="button"
                    className={configuredModel === "auto" ? "is-selected" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectAgentModel("auto")}
                    aria-pressed={configuredModel === "auto"}
                  >
                    <strong>Default model</strong>
                    <span>{selectedRuntimeStatus?.label || "Selected runtime"} decides</span>
                  </button>
                  {modelOptions.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={configuredModel === model.id ? "is-selected" : ""}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectAgentModel(model.id)}
                      aria-pressed={configuredModel === model.id}
                    >
                      <strong>{model.label}</strong>
                      <span>
                        {model.description || (model.label !== model.id ? model.id : model.source || "detected")}
                      </span>
                    </button>
                  ))}
                </menu>
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
                    : "Reasoning effort. Use Default effort to let the selected runtime choose."
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
          {agentRuntimeUnavailable ? (
            <p className="agent-runtime-warning">
              {AGENT_RUNTIME_UNAVAILABLE_MESSAGE}
              <code>skribe doctor</code>.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LeftRail() {
  const {
    isLeftRailCollapsed,
    isRestoringRevision,
    isRevisionHistoryOpen,
    openThreadCount,
    outline,
    revisionState,
    words,
    restoreRevision,
    setIsRevisionHistoryOpen,
    updatePanelState
  } = useSkribeControllerContext();

  return (
    <aside className="left-rail">
      <button
        type="button"
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
          <button
            type="button"
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
  );
}

function CenterPane() {
  const {
    activeBlockId,
    activeInlineProposal,
    activeThread,
    appSettings,
    blockResetKeys,
    blocks,
    canvasRef,
    documentState,
    editorLanguage,
    isFlowMode,
    pendingSelectionDraft,
    reviewableProposals,
    selectionDraft,
    threads,
    activateThread,
    commitCanvasDom,
    deleteCanvasBlock,
    focusCanvasBlock,
    handleCanvasContextMenu,
    handleCanvasCopy,
    handleCanvasCut,
    handleCanvasKeyDown,
    handleCanvasPaste,
    handleCanvasPointerCancel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleCanvasSelectionEvent,
    handleCanvasDrop,
    handleEditorShortcut,
    moveCanvasBlock,
    notifyTableImageExported,
    registerBlockRef,
    rememberCanvasSelection,
    requestProposalRevision,
    requestProposalRewrite,
    scheduleLiveCanvasCommit,
    setPanelMode,
    updateCanvasBlock,
    updateFloatingToolbarPosition,
    updateProposalChangeDecision,
    updateProposalStatus,
    toggleTaskListItem,
    editTable
  } = useSkribeControllerContext();

  if (!documentState) return null;

  return (
    <section className="center-pane">
      {isFlowMode ? null : <CanvasToolbar />}
      <div
        ref={canvasRef}
        className="markdown-canvas"
        lang={editorLanguage}
        role="application"
        aria-label="Markdown editor"
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
        {isFlowMode ? null : (
          <InlineProposalReviewBar
            review={activeInlineProposal}
            proposalCount={reviewableProposals.length}
            onProposalStatus={updateProposalStatus}
            onRequestProposalRewrite={requestProposalRewrite}
          />
        )}
        <EditableMarkdownCanvas
          markdown={documentState.markdown}
          blocks={blocks}
          editorLanguage={editorLanguage}
          threads={isFlowMode ? [] : threads}
          inlineProposal={isFlowMode ? null : activeInlineProposal}
          diffViewMode={appSettings.diffViewMode}
          selectionPreview={isFlowMode ? null : selectionDraft ?? pendingSelectionDraft}
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
          onToggleTask={toggleTaskListItem}
          onEditTable={editTable}
          onProposalChangeDecision={updateProposalChangeDecision}
          onRequestProposalRevision={requestProposalRevision}
          onTableImageExported={notifyTableImageExported}
        />
      </div>
    </section>
  );
}

function CanvasToolbar() {
  const {
    activeBlockId,
    imageInputRef,
    applyInlineCode,
    applyInlineCommand,
    openLinkPopover,
    startCommentFromSelection,
    updateActiveBlockShape,
    insertThematicBreakAfterBlock,
    insertTableAfterBlock
  } = useSkribeControllerContext();

  return (
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
        <button type="button" title="Strikethrough (Ctrl/Cmd+Shift+X)" onMouseDown={(event) => { event.preventDefault(); applyInlineCommand("strikeThrough"); }}>
          <Strikethrough size={16} />
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
        <button type="button" title="Code block (Ctrl/Cmd+Alt+C)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "code", level: undefined, marker: undefined }); }}>
          <SquareCode size={16} />
        </button>
        <button type="button" title="Horizontal rule" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); if (activeBlockId) insertThematicBreakAfterBlock(activeBlockId); }}>
          <Minus size={16} />
        </button>
        <button type="button" title="Insert table" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); if (activeBlockId) insertTableAfterBlock(activeBlockId); }}>
          <Table size={16} />
        </button>
        <span className="toolbar-divider" />
        <button type="button" title="Comment on selected text" onMouseDown={(event) => { event.preventDefault(); startCommentFromSelection(); }}>
          <MessageSquare size={16} />
        </button>
      </div>
    </div>
  );
}

function RightPanel() {
  const {
    activeThread,
    activeThreadId,
    agentRuntimeUnavailable,
    agentSession,
    agentSkills,
    appSettings,
    chatDraft,
    chatSkillIds,
    contextLedger,
    documentState,
    newComment,
    newThreadSkillIds,
    panelMode,
    pendingSelectionDraft,
    proposals,
    replyDrafts,
    resolvedThreadCount,
    selectionDraft,
    showResolvedThreads,
    threadSkillIds,
    visibleThreads,
    activateThread,
    addChatMessage,
    addThread,
    addThreadMessage,
    persistSettings,
    requestProposalRevision,
    requestThreadAgentReply,
    setChatDraft,
    setChatSkillIds,
    setFloatingToolbar,
    setNewComment,
    setNewThreadSkillIds,
    setPanelMode,
    setPendingSelectionDraft,
    setReplyDrafts,
    setSelectionDraft,
    setThreadSkillIds,
    updatePanelState,
    updateProposalChangeDecision,
    updateProposalStatus,
    updateSuggestionStatus,
    updateThreadStatus,
    isRightPanelCollapsed,
    selectionRangeRef
  } = useSkribeControllerContext();
  const humanLabel = humanAuthorLabel(appSettings);

  if (!documentState) return null;

  return (
    <aside className="right-panel">
      <button
        type="button"
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
            humanLabel={humanLabel}
            agentRuntimeUnavailable={agentRuntimeUnavailable}
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
            humanLabel={humanLabel}
            agentRuntimeUnavailable={agentRuntimeUnavailable}
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
  );
}

function SkribeOverlays() {
  const {
    activeBlockId,
    agentSkills,
    appSettings,
    floatingToolbar,
    isFlowMode,
    isSettingsOpen,
    linkDraft,
    linkInputRef,
    linkPopover,
    linkRangeRef,
    linkTargetRef,
    firstRunStep,
    providerOptions,
    resolvedRuntime,
    selectionContextMenu,
    settingsDraft,
    settingsSaveState,
    toneSetupInvocation,
    applyInlineCode,
    applyInlineCommand,
    applyLink,
    cancelSettingsDialog,
    continueFirstRunAgentSetup,
    copyActiveSelectionToClipboard,
    cutActiveSelectionToClipboard,
    openLinkPopover,
    pasteClipboardFromMenu,
    saveSettingsDraft,
    saveToneOfVoiceSetup,
    setLinkDraft,
    setLinkPopover,
    setSelectionContextMenu,
    setToneSetupInvocation,
    skipFirstRunAgentSetup,
    skipToneOfVoiceSetup,
    startCommentFromSelection,
    toneSettingsBase,
    updateActiveBlockShape,
    updateSettingsDraft,
    imageInputRef
  } = useSkribeControllerContext();

  if (isFlowMode) return null;

  return (
    <>
      {floatingToolbar ? (
        <FloatingFormatToolbar
          position={floatingToolbar}
          activeBlockId={activeBlockId}
          onParagraph={() => updateActiveBlockShape({ type: "paragraph", level: undefined })}
          onHeading={(level) => updateActiveBlockShape({ type: "heading", level })}
          onCodeBlock={() => updateActiveBlockShape({ type: "code", level: undefined, marker: undefined })}
          onBold={() => applyInlineCommand("bold")}
          onItalic={() => applyInlineCommand("italic")}
          onStrikethrough={() => applyInlineCommand("strikeThrough")}
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
          onCancel={cancelSettingsDialog}
        />
      ) : null}

      {firstRunStep === "agent" ? (
        <FirstRunAgentDialog
          settings={settingsDraft}
          runtimeOptions={providerOptions}
          resolvedRuntime={resolvedRuntime}
          onChange={updateSettingsDraft}
          onContinue={continueFirstRunAgentSetup}
          onSkip={skipFirstRunAgentSetup}
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
          tabIndex={-1}
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
    </>
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
  onSubmit,
  disabled = false,
  disabledReason
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
  disabled?: boolean;
  disabledReason?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const slashCommand = getActiveSlashCommand(value, cursor);
  const query = slashCommand?.query ?? "";
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills: AgentSkill[] = [];
  for (const id of selectedSkillIds) {
    const skill = skillsById.get(id);
    if (skill) selectedSkills.push(skill);
  }
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
      {disabled && disabledReason ? <p className="agent-unavailable-note">{disabledReason}</p> : null}
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
          disabled={disabled}
        />

        {autocompleteOptions.length > 0 && slashCommand ? (
          <menu className="skill-autocomplete">
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
          </menu>
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
        <button type="button" className="primary-button" onClick={onSubmit} disabled={disabled}>
          {submitIcon}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface MarkdownCanvasProps {
  markdown: string;
  blocks: ReturnType<typeof parseMarkdownBlocks>;
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
  onToggleTask: (blockId: string) => void;
  onEditTable: (blockId: string, edit: TableEdit) => void;
  onProposalChangeDecision: (proposalId: string, changeKey: string, decision: ProposalChangeDecision) => void;
  onRequestProposalRevision: (proposalId: string, change: ProposalChangeBlock, instruction: string) => void;
  onTableImageExported: (status: "success" | "error") => void;
}

function FloatingFormatToolbar({
  position,
  activeBlockId,
  onParagraph,
  onHeading,
  onCodeBlock,
  onBold,
  onItalic,
  onStrikethrough,
  onInlineCode,
  onLink,
  onImage,
  onComment
}: {
  position: FloatingToolbarState;
  activeBlockId: string | null;
  onParagraph: () => void;
  onHeading: (level: 1 | 2 | 3) => void;
  onCodeBlock: () => void;
  onBold: () => void;
  onItalic: () => void;
  onStrikethrough: () => void;
  onInlineCode: () => void;
  onLink: () => void;
  onImage: () => void;
  onComment: () => void;
}) {
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
      <button type="button" title="Code block" disabled={!activeBlockId} onMouseDown={keepSelection} onClick={onCodeBlock}>
        <SquareCode size={15} />
      </button>
      <span className="toolbar-divider" />
      <button type="button" title="Bold" onMouseDown={keepSelection} onClick={onBold}>
        <Bold size={15} />
      </button>
      <button type="button" title="Italic" onMouseDown={keepSelection} onClick={onItalic}>
        <Italic size={15} />
      </button>
      <button type="button" title="Strikethrough" onMouseDown={keepSelection} onClick={onStrikethrough}>
        <Strikethrough size={15} />
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
    <form
      className="link-popover"
      style={{ left: position.left, top: position.top }}
      aria-label="Insert link"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
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
    </form>
  );
}

function EditableMarkdownCanvas({
  markdown,
  blocks,
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
  onToggleTask,
  onEditTable,
  onProposalChangeDecision,
  onRequestProposalRevision,
  onTableImageExported
}: MarkdownCanvasProps) {
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ blockId: string; placement: BlockDropPlacement } | null>(null);
  const visibleBlocks = useMemo(() => {
    const base = blocks.length > 0 ? blocks : [{ id: markdownBlockIdFromIndex(0), type: "paragraph" as const, text: "" }];
    // Renumber ordered-list markers per contiguous run so the displayed numbers
    // stay sequential (1, 2, 3…) after items are deleted, reordered, or all typed
    // as "1.". Display only — the stored markdown markers are left untouched, so
    // block text offsets (and comment anchors) are unaffected.
    let ordinal = 0;
    return base.map((block) => {
      if (block.type !== "ordered-list") {
        ordinal = 0;
        return block;
      }
      ordinal += 1;
      const marker = String(ordinal);
      return block.marker === marker ? block : { ...block, marker };
    });
  }, [blocks]);
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
  const anchorRangesByBlock = useMemo(() => {
    const byBlock = new Map<string, BlockAnchorRange[]>();
    // Block ids are stable (reconciled), but line spans come from a positional
    // re-parse, so align them by document order rather than by id.
    const spansByBlock = new Map(visibleBlocks.map((block, index) => [block.id, blockSpans[index] ?? null]));

    // Resolve each anchor's CURRENT position by re-finding its text rather than
    // trusting the absolute offset captured when the comment was made — otherwise
    // editing text above a comment shifts the document and the highlight drifts.
    const resolvedRanges = new Map<string, { start: number; end: number }>();
    for (const thread of canvasThreads) {
      if (thread.anchor.kind !== "markdown-range") continue;
      if (thread.status !== "open" && thread.id !== canvasActiveThreadId) continue;
      const resolved = resolveSelectionDraftRange(markdown, thread.anchor);
      if (resolved && resolved.end > resolved.start) resolvedRanges.set(thread.id, resolved);
    }

    for (const block of visibleBlocks) {
      const blockSpan = spansByBlock.get(block.id) ?? null;
      if (blockSpan === null) continue;

      const blockAnchorRanges: BlockAnchorRange[] = [];
      for (const thread of canvasThreads) {
        const resolved = resolvedRanges.get(thread.id);
        if (!resolved || resolved.end <= blockSpan.textStart || resolved.start >= blockSpan.textEnd) {
          continue;
        }

        const range = {
          thread,
          start: clamp(resolved.start - blockSpan.textStart, 0, block.text.length),
          end: clamp(resolved.end - blockSpan.textStart, 0, block.text.length)
        };
        if (range.end > range.start) blockAnchorRanges.push(range);
      }

      if (blockAnchorRanges.length > 0) byBlock.set(block.id, blockAnchorRanges);
    }
    return byBlock;
  }, [blockSpans, canvasActiveThreadId, canvasThreads, markdown, visibleBlocks]);
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

  function focusCurrentSelectionBlock(target?: EventTarget | null) {
    const targetBlock =
      target instanceof Node ? closestEditableBlock(target)?.dataset.blockId ?? null : currentBlockIdFromSelection();
    const blockId = targetBlock ?? currentBlockIdFromSelection();
    if (blockId) onFocusBlock(blockId);
    return blockId;
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
      >
        {visibleBlocks.map((block, blockIndex) => {
          const blockAnchorRanges = anchorRangesByBlock.get(block.id) ?? emptyBlockAnchorRanges;
          // Inline-proposal changes are anchored to positional block ids; map this
          // block's position to that key (block ids themselves are stable).
          const inlineChanges = inlineChangesByBlock.get(markdownBlockIdFromIndex(blockIndex)) ?? [];

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
                  onCommitDocument={onCommitDocument}
                  onDocumentInput={onDocumentInput}
                  onToggleTask={onToggleTask}
                  onEditTable={onEditTable}
                  onTableImageExported={onTableImageExported}
                />
              </EditableBlockShell>
              {inlineChanges.map((change) => (
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
  onCommitDocument: () => void;
  onDocumentInput: () => void;
  onToggleTask: (blockId: string) => void;
  onEditTable: (blockId: string, edit: TableEdit) => void;
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
  onCommitDocument,
  onDocumentInput,
  onToggleTask,
  onEditTable,
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
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      const documentRoot = event.currentTarget.closest(".editable-document");
      if (documentRoot?.contains(event.relatedTarget as Node | null)) return;
      onCommitDocument();
    },
    onInput: onDocumentInput,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: true,
    lang: editorLanguage,
    "data-placeholder": "Start writing...",
    className: "editable-text"
  };

  // A deliberately empty block (created by Enter, marked with a zero-width space)
  // renders a <br> so the contentEditable has a reliable, focusable caret line.
  // A genuinely empty block (e.g. an empty document) renders nothing so its
  // placeholder shows.
  const isMarkedEmpty = block.text.length > 0 && block.text.replace(/\u200b/g, "").trim() === "";
  const children = isMarkedEmpty ? (
    <br />
  ) : (
    renderHighlightedText(block.text, threads, activeThreadId, onActivateThread, anchorRanges)
  );

  if (block.type === "heading") {
    // Render the actual level (up to h6) so the displayed heading matches the
    // Markdown source (#### shows as an h4), instead of clamping every deep
    // heading to h3 while the source kept its level.
    const level = Math.min(Math.max(block.level ?? 2, 1), 6);
    const tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return React.createElement(
      tag,
      {
        ...editableProps,
        id: block.id,
        className: `editable-text editable-heading level-${level}`
      },
      children
    );
  }

  if (block.type === "ordered-list" || block.type === "unordered-list") {
    const isTask = block.type === "unordered-list" && block.checked !== undefined;
    return (
      <div className={`editable-list-row ${block.type}${isTask ? " task" : ""}${isTask && block.checked ? " checked" : ""}`}>
        {isTask ? (
          <button
            type="button"
            className="editable-task-checkbox"
            role="checkbox"
            aria-checked={block.checked}
            aria-label={block.checked ? "Mark task not done" : "Mark task done"}
            contentEditable={false}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onToggleTask(block.id)}
          >
            {block.checked ? <Check size={13} /> : null}
          </button>
        ) : (
          <span className="editable-list-marker">{block.type === "ordered-list" ? `${block.marker ?? "1"}.` : "-"}</span>
        )}
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

  if (block.type === "thematic-break") {
    return (
      <div
        id={block.id}
        data-block-id={block.id}
        className="editable-thematic-break"
        contentEditable={false}
        tabIndex={0}
        role="separator"
        aria-label="Horizontal rule"
        ref={(node) => onRegisterBlock(block.id, node)}
        onClick={() => onFocusBlock(block.id)}
        onFocus={() => onFocusBlock(block.id)}
        onKeyDown={(event) => onShortcut(event, block.id)}
      >
        <hr />
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <EditableImageBlock
        block={block}
        onRegisterBlock={onRegisterBlock}
        onFocusBlock={onFocusBlock}
        onShortcut={onShortcut}
      />
    );
  }

  if (block.type === "table") {
    return (
      <EditableTableBlock
        block={block}
        editableProps={editableProps}
        onEditTable={onEditTable}
        onTableImageExported={onTableImageExported}
      />
    );
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
  onFocusBlock,
  onShortcut
}: {
  block: ReturnType<typeof parseMarkdownBlocks>[number];
  onRegisterBlock: (blockId: string, node: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
  onShortcut: (event: React.KeyboardEvent<HTMLElement>, blockId: string) => void;
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
    <button
      type="button"
      id={block.id}
      data-block-id={block.id}
      className="editable-image-block"
      contentEditable={false}
      aria-label={image?.alt ? `Image block: ${image.alt}` : "Image block"}
      ref={(node) => onRegisterBlock(block.id, node)}
      onClick={() => onFocusBlock(block.id)}
      onFocus={() => onFocusBlock(block.id)}
      onKeyDown={(event) => onShortcut(event, block.id)}
    >
      <div className="editable-image-frame">
        <img src={imagePreviewSrc(image.src)} alt={image.alt} title={image.title} loading="lazy" />
      </div>
      <span className="editable-image-caption">
        <span>{image.alt || imageDisplayName(image.src)}</span>
        <small>{image.src}</small>
      </span>
    </button>
  );
}

function EditableTableBlock({
  block,
  editableProps,
  onEditTable,
  onTableImageExported
}: {
  block: ReturnType<typeof parseMarkdownBlocks>[number];
  editableProps: React.HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void; "data-block-id": string };
  onEditTable: (blockId: string, edit: TableEdit) => void;
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
  const hasBodyRows = table.rows.length > 0;
  // Deleting the last body row would leave a header-only table (blocked in
  // withTableRowRemoved), so only offer the delete-row control at two rows or more.
  const canDeleteRows = table.rows.length > 1;
  const rows = hasBodyRows ? table.rows : [Array.from({ length: columnCount }, () => "")];
  const headerCells = keyedRenderItems(headers, `header-${block.id}`, (cell) => cell);
  const rowEntries = keyedRenderItems(rows, `row-${block.id}`, (row) => row.join("\u001f"));
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
  // Structure controls sit inside the contentEditable table, so keep the caret put
  // (preventDefault on mousedown) and don't let the click bubble into cell editing.
  const keepCaret = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const runEdit = (edit: TableEdit) => (event: React.MouseEvent) => {
    keepCaret(event);
    onEditTable(block.id, edit);
  };

  return (
    <div className="editable-table-shell">
      <button
        type="button"
        className="table-image-download"
        contentEditable={false}
        onMouseDown={keepCaret}
        onClick={(event) => {
          keepCaret(event);
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
            {headerCells.map(({ item: cell, key }, columnIndex) => (
              <th key={key} style={cellStyle(columnIndex)}>
                {cell ? <InlineMarkdown markdown={cell} keyPrefix={key} /> : <br />}
                {columnCount > 2 ? (
                  <button
                    type="button"
                    className="table-delete-column"
                    contentEditable={false}
                    title="Delete column"
                    aria-label="Delete column"
                    onMouseDown={keepCaret}
                    onClick={runEdit({ kind: "delete-column", index: columnIndex })}
                  >
                    <X size={11} />
                  </button>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowEntries.map(({ item: row, key: rowKey }, rowIndex) => {
            const cells = Array.from({ length: columnCount }, (_, columnIndex) => row[columnIndex] ?? "");
            const rowCells = keyedRenderItems(cells, `cell-${rowKey}`, (cell) => cell);
            return (
              <tr key={rowKey}>
                {rowCells.map(({ item: cell, key }, columnIndex) => (
                  <td key={key} style={cellStyle(columnIndex)}>
                    {columnIndex === 0 && canDeleteRows ? (
                      <button
                        type="button"
                        className="table-delete-row"
                        contentEditable={false}
                        title="Delete row"
                        aria-label="Delete row"
                        onMouseDown={keepCaret}
                        onClick={runEdit({ kind: "delete-row", index: rowIndex })}
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                    {cell ? <InlineMarkdown markdown={cell} keyPrefix={key} /> : <br />}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="table-add-column"
        contentEditable={false}
        title="Add column"
        aria-label="Add column"
        onMouseDown={keepCaret}
        onClick={runEdit({ kind: "add-column" })}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        className="table-add-row"
        contentEditable={false}
        title="Add row"
        aria-label="Add row"
        onMouseDown={keepCaret}
        onClick={runEdit({ kind: "add-row" })}
      >
        <Plus size={14} />
      </button>
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
    previous.block.checked === next.block.checked &&
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
  const exactRanges: Array<{ thread: ReviewThread; start: number; end: number }> = [];
  for (const thread of threads) {
    if (thread.anchor.kind === "markdown-range" || (thread.status !== "open" && thread.id !== activeThreadId) || !thread.anchor.exact) {
      continue;
    }
    const match = findThreadAnchorInText(thread, text);
    if (match) {
      exactRanges.push({
        thread,
        start: match.start,
        end: match.end
      });
    }
  }
  const ranges = [...anchorRanges, ...exactRanges]
    .sort((a, b) => a!.start - b!.start) as Array<{ thread: ReviewThread; start: number; end: number }>;

  if (ranges.length === 0) {
    if (!text) return null;
    return <InlineMarkdown markdown={text} />;
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
    // Render the comment highlight as an inline <span>, not a <button>. A button
    // inside a contentEditable is an atomic, non-editable element: the caret
    // can't land inside it and arrow keys skip over it, so commented text became
    // effectively read-only. A span keeps the text editable; clicking it (a
    // collapsed selection) still activates the thread, and the thread remains
    // reachable from the side panel for keyboard users.
    nodes.push(
      <span
        key={range.thread.id}
        data-thread-id={range.thread.id}
        className={`anchor-highlight ${isActive ? "is-active" : ""}`}
        onClick={() => {
          if (range.thread.id === "selection-preview") return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
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
  humanLabel: string;
  agentRuntimeUnavailable: boolean;
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
    humanLabel,
    agentRuntimeUnavailable,
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
            disabled={agentRuntimeUnavailable}
            disabledReason={`${AGENT_RUNTIME_UNAVAILABLE_MESSAGE}skribe doctor.`}
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
                disabled={isAgentWorkingForActiveThread || agentRuntimeUnavailable}
                onClick={() => onRequestAgentReply(activeThread.id)}
                title={agentRuntimeUnavailable ? AGENT_RUNTIME_UNAVAILABLE_SHORT : undefined}
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
                  <strong>{authorLabel(message.author, humanLabel)}</strong>
                  <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                {message.body ? <p>{displayAgentMessageBody(message.body)}</p> : null}
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
              disabled={agentRuntimeUnavailable}
              disabledReason={`${AGENT_RUNTIME_UNAVAILABLE_MESSAGE}skribe doctor.`}
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
    const deletionLines = keyedRenderItems(deletions, "delete", diffLineText);
    const additionLines = keyedRenderItems(additions, "add", diffLineText);
    return (
      <div className={`proposal-change-preview is-unified is-${variant}`}>
        <span>Unified diff</span>
        <div className="proposal-unified-lines">
          {deletionLines.length > 0 ? (
            deletionLines.map(({ item: line, key }) => (
              <div key={key} className="proposal-unified-line is-delete">
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
          {additionLines.length > 0 ? (
            additionLines.map(({ item: line, key }) => (
              <div key={key} className="proposal-unified-line is-add">
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
  humanLabel: string;
  agentRuntimeUnavailable: boolean;
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
  humanLabel,
  agentRuntimeUnavailable,
  onSetChatDraft,
  onSetSelectedSkillIds,
  onSend,
  onProposalStatus,
  onProposalChangeDecision,
  onRequestProposalRevision
}: ChatPanelProps) {
  const isAgentWorkingInChat = agentSession?.status === "running" && agentSession.activeTurn?.source === "chat";
  const chatStackRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    stickToBottomIfNear(chatStackRef.current);
  }, [messages, proposals, isAgentWorkingInChat]);
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
      <div className="message-stack chat-stack" ref={chatStackRef}>
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
                  {formatLedgerSummaryForDisplay(event.summary, humanLabel)}
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
                <strong>{authorLabel(message.author, humanLabel)}</strong>
                <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              {message.body ? <p>{displayAgentMessageBody(message.body)}</p> : null}
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
          disabled={agentRuntimeUnavailable}
          disabledReason={`${AGENT_RUNTIME_UNAVAILABLE_MESSAGE}skribe doctor.`}
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

export default App;
