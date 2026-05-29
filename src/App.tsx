import React, { useEffect, useMemo, useRef, useState } from "react";
import { diffAcceptRejectHunk, parseDiffFromFile } from "@pierre/diffs";
import { MultiFileDiff } from "@pierre/diffs/react";
import {
  Bold,
  Check,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Clipboard,
  Copy,
  Download,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Import,
  List,
  ListOrdered,
  MessageSquare,
  Pilcrow,
  Quote,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  SplitSquareVertical,
  X
} from "lucide-react";
import { fetchDocument, saveDocument, sendAgentMessage, subscribeToDocumentEvents } from "./api";
import {
  applySuggestion,
  buildSelection,
  extractOutline,
  makeId,
  nowIso,
  openThreads,
  titleFromMarkdown,
  wordCount,
  htmlToInlineMarkdown,
  inlineMarkdownToHtml,
  parseMarkdownBlocks,
  updateMarkdownBlock,
  updateMarkdownBlockShape
} from "./document";
import type {
  AgentSession,
  Author,
  ChatMessage,
  ContextLedgerEvent,
  ContextLedgerEventType,
  DocumentProposal,
  DocumentState,
  ProposalChangeDecision,
  ReviewThread,
  SelectionDraft,
  Suggestion
} from "./types";
import type { FileDiffMetadata } from "@pierre/diffs";

type PanelMode = "threads" | "chat";
type SaveState = "loading" | "saved" | "saving" | "error";

const authorLabels: Record<Author, string> = {
  human: "Human",
  agent: "Agent"
};

const maxContextLedgerEvents = 240;

interface ProposalChangeBlock {
  key: string;
  hunkIndex: number;
  changeIndex: number;
  ordinal: number;
  deletionLineStart: number;
  additionLineStart: number;
  deletions: string[];
  additions: string[];
}

function buildProposalDiff(proposal: DocumentProposal): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name: "draft.md",
      contents: proposal.originalMarkdown,
      lang: "markdown",
      cacheKey: `${proposal.id}:original`
    },
    {
      name: "draft.md",
      contents: proposal.replacementMarkdown,
      lang: "markdown",
      cacheKey: `${proposal.id}:replacement`
    }
  );
}

function getProposalChangeBlocks(fileDiff: FileDiffMetadata): ProposalChangeBlock[] {
  let ordinal = 1;
  return fileDiff.hunks.flatMap((hunk, hunkIndex) =>
    hunk.hunkContent.flatMap((content, changeIndex) => {
      if (content.type !== "change") return [];
      const block: ProposalChangeBlock = {
        key: `${hunkIndex}:${changeIndex}`,
        hunkIndex,
        changeIndex,
        ordinal,
        deletionLineStart: content.deletionLineIndex + 1,
        additionLineStart: content.additionLineIndex + 1,
        deletions: fileDiff.deletionLines.slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions),
        additions: fileDiff.additionLines.slice(content.additionLineIndex, content.additionLineIndex + content.additions)
      };
      ordinal += 1;
      return [block];
    })
  );
}

function buildMarkdownFromProposalDecisions(
  proposal: DocumentProposal,
  decisions: Record<string, ProposalChangeDecision>
) {
  const originalDiff = buildProposalDiff(proposal);
  const changes = getProposalChangeBlocks(originalDiff);
  if (changes.length === 0) return proposal.replacementMarkdown;

  let resolvedDiff = originalDiff;
  changes.forEach((change) => {
    resolvedDiff = diffAcceptRejectHunk(resolvedDiff, change.hunkIndex, {
      type: decisions[change.key] === "accepted" ? "accept" : "reject",
      changeIndex: change.changeIndex
    });
  });

  return resolvedDiff.additionLines.join("");
}

function resolveProposalStatus(
  changes: ProposalChangeBlock[],
  decisions: Record<string, ProposalChangeDecision>
): DocumentProposal["status"] {
  if (changes.length === 0) return "accepted";
  if (!changes.every((change) => decisions[change.key])) return "open";
  if (changes.every((change) => decisions[change.key] === "accepted")) return "accepted";
  if (changes.every((change) => decisions[change.key] === "rejected")) return "rejected";
  return "reviewed";
}

function lineRangeLabel(start: number, count: number) {
  if (count === 0) return "insert";
  if (count === 1) return String(start);
  return `${start}-${start + count - 1}`;
}

function trimBlockText(lines: string[]) {
  return lines.join("").trim() || "(empty)";
}

function clipText(text: string, maxLength = 260) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
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

function summarizeOpenProposal(proposal: DocumentProposal) {
  const decisions = proposal.changeDecisions ?? {};
  return {
    id: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    status: proposal.status,
    source: proposal.source,
    threadId: proposal.threadId ?? null,
    reviewedBlocks: Object.keys(decisions).length,
    acceptedBlocks: Object.values(decisions).filter((decision) => decision === "accepted").length,
    rejectedBlocks: Object.values(decisions).filter((decision) => decision === "rejected").length
  };
}

function App() {
  const [documentState, setDocumentState] = useState<DocumentState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [panelMode, setPanelMode] = useState<PanelMode>("threads");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [isLeftRailCollapsed, setIsLeftRailCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [suggestionDrafts, setSuggestionDrafts] = useState<Record<string, string>>({});
  const [chatDraft, setChatDraft] = useState("");
  const [replyAuthor, setReplyAuthor] = useState<Author>("human");
  const [chatAuthor, setChatAuthor] = useState<Author>("human");
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});
  const saveTimerRef = useRef<number | null>(null);
  const stateRef = useRef<DocumentState | null>(null);
  const saveRef = useRef<SaveState>("loading");

  useEffect(() => {
    fetchDocument()
      .then((loaded) => {
        stateRef.current = loaded;
        setDocumentState(loaded);
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  }, []);

  useEffect(() => {
    saveRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    return subscribeToDocumentEvents((remote) => {
      stateRef.current = remote;
      setDocumentState(remote);
      if (saveRef.current !== "saving") setSaveState("saved");
    });
  }, []);

  const outline = useMemo(() => extractOutline(documentState?.markdown ?? ""), [documentState?.markdown]);
  const words = useMemo(() => wordCount(documentState?.markdown ?? ""), [documentState?.markdown]);
  const threads = documentState?.review.threads ?? [];
  const proposals = documentState?.review.proposals ?? [];
  const contextLedger = documentState?.review.contextLedger ?? [];
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null;
  const openThreadCount = openThreads(threads).length;
  const agentSession = documentState?.agentSession;

  function commit(updater: (state: DocumentState) => DocumentState) {
    if (!stateRef.current) return null;

    const next = updater(stateRef.current);
    stateRef.current = next;
    setDocumentState(next);
    setSaveState("saving");

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveDocument(next)
        .then((saved) => {
          stateRef.current = saved;
          setDocumentState(saved);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 350);

    return next;
  }

  function triggerAgent(source: "chat" | "thread", body: string, nextState: DocumentState | null, threadId?: string | null) {
    if (!nextState) return;
    sendAgentMessage({ source, body, threadId, document: nextState })
      .then((remote) => {
        stateRef.current = remote;
        setDocumentState(remote);
        setSaveState("saved");
      })
      .catch(() => setSaveState("error"));
  }

  function handleSelection() {
    if (!documentState || !canvasRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!canvasRef.current.contains(range.commonAncestorContainer)) return;

    const selectedText = selection.toString().replace(/\s+/g, " ").trim();
    if (selectedText.length < 3) return;

    const nextSelection = buildSelection(documentState.markdown, selectedText);
    setSelectionDraft(nextSelection);
    setPanelMode("threads");
  }

  function addThread() {
    if (!selectionDraft || !newComment.trim()) return;

    const createdAt = nowIso();
    const thread: ReviewThread = {
      id: makeId("thread"),
      status: "open",
      anchor: selectionDraft,
      messages: [
        {
          id: makeId("msg"),
          author: "human",
          body: newComment.trim(),
          createdAt
        }
      ],
      suggestions: [],
      createdAt,
      updatedAt: createdAt
    };
    const ledgerEvent = createLedgerEvent({
      type: "thread_created",
      actor: "human",
      summary: `Created anchored thread on "${selectionDraft.exact}" with note: ${newComment.trim()}`,
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
    triggerAgent("thread", newComment.trim(), nextState, thread.id);

    setActiveThreadId(thread.id);
    setSelectionDraft(null);
    setNewComment("");
    window.getSelection()?.removeAllRanges();
  }

  function addThreadMessage(threadId: string) {
    const body = replyDrafts[threadId]?.trim();
    if (!body) return;

    const createdAt = nowIso();
    const nextState = commit((state) => {
      const thread = state.review.threads.find((item) => item.id === threadId);
      const ledgerEvent = createLedgerEvent({
        type: "thread_message",
        actor: replyAuthor,
        summary: `${authorLabels[replyAuthor]} replied to thread${thread ? ` on "${thread.anchor.exact}"` : ""}: ${body}`,
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
                      author: replyAuthor,
                      body,
                      createdAt
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
    if (replyAuthor === "human") triggerAgent("thread", body, nextState, threadId);

    setReplyDrafts((drafts) => ({ ...drafts, [threadId]: "" }));
  }

  function addSuggestion(thread: ReviewThread) {
    const replacement = suggestionDrafts[thread.id]?.trim();
    if (!replacement) return;

    const createdAt = nowIso();
    const suggestion: Suggestion = {
      id: makeId("sug"),
      threadId: thread.id,
      type: "replace",
      original: thread.anchor.exact,
      replacement,
      status: "open",
      author: "agent",
      createdAt
    };

    commit((state) => ({
      ...state,
      review: {
        ...state.review,
        threads: state.review.threads.map((item) =>
          item.id === thread.id
            ? {
                ...item,
                suggestions: [...item.suggestions, suggestion],
                updatedAt: createdAt
              }
            : item
        ),
        contextLedger: appendLedgerEvents(state.review.contextLedger, [
          createLedgerEvent({
            type: "thread_suggestion_created",
            actor: "agent",
            summary: `Saved manual agent replacement suggestion for "${thread.anchor.exact}": ${replacement}`,
            createdAt,
            threadId: thread.id
          })
        ]),
        updatedAt: createdAt
      }
    }));

    setSuggestionDrafts((drafts) => ({ ...drafts, [thread.id]: "" }));
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
        status === "accepted" && suggestion
          ? applySuggestion(state.markdown, suggestion.original, suggestion.replacement)
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
      return {
        ...state,
        markdown:
          status === "accepted" && proposal
            ? proposal.replacementMarkdown
            : status === "rejected" && proposal
              ? buildMarkdownFromProposalDecisions(proposal, decisions)
              : state.markdown,
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
      const markdown = buildMarkdownFromProposalDecisions(proposal, nextDecisions);

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
      `Please revise change ${change.ordinal} in proposal "${proposal.title}".`,
      `Instruction: ${body}`,
      `Original block:\n${trimBlockText(change.deletions)}`,
      `Proposed block:\n${trimBlockText(change.additions)}`,
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

    setPanelMode("chat");
    triggerAgent("chat", messageBody, nextState);
  }

  function addChatMessage() {
    const body = chatDraft.trim();
    if (!body) return;

    const createdAt = nowIso();
    const message: ChatMessage = {
      id: makeId("chat"),
      author: chatAuthor,
      body,
      createdAt
    };

    const nextState = commit((state) => ({
      ...state,
      review: {
        ...state.review,
        chat: [...state.review.chat, message],
        contextLedger: appendLedgerEvents(state.review.contextLedger, [
          createLedgerEvent({
            type: "chat_message",
            actor: chatAuthor,
            summary: `${authorLabels[chatAuthor]} chat message: ${body}`,
            createdAt
          })
        ]),
        updatedAt: createdAt
      }
    }));
    if (chatAuthor === "human") triggerAgent("chat", body, nextState);

    setChatDraft("");
  }

  function updateCanvasBlock(blockId: string, html: string) {
    const text = htmlToInlineMarkdown(html);
    commit((state) => ({
      ...state,
      markdown: updateMarkdownBlock(state.markdown, blockId, text),
      review: {
        ...state.review,
        updatedAt: nowIso()
      }
    }));
  }

  function registerBlockRef(blockId: string, node: HTMLElement | null) {
    blockRefs.current[blockId] = node;
  }

  function updateBlockShape(blockId: string, patch: Parameters<typeof updateMarkdownBlockShape>[2]) {
    const node = blockRefs.current[blockId];
    const currentText = node ? htmlToInlineMarkdown(node.innerHTML) : null;

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
    document.execCommand(command);
  }

  function applyInlineCode() {
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
  }

  function handleEditorShortcut(event: React.KeyboardEvent<HTMLElement>, blockId: string) {
    const isCommand = event.metaKey || event.ctrlKey;
    if (!isCommand) return;

    const key = event.key.toLowerCase();
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

  function updateTitle(title: string) {
    commit((state) => ({
      ...state,
      review: {
        ...state.review,
        title,
        updatedAt: nowIso()
      }
    }));
  }

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setLastCopied(label);
    window.setTimeout(() => setLastCopied(null), 1400);
  }

  function exportMarkdown() {
    if (!documentState) return;
    const blob = new Blob([documentState.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${documentState.review.title || "draft"}.md`.replace(/[^\w.-]+/g, "-");
    link.click();
    URL.revokeObjectURL(url);
  }

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

  function buildAgentPacket() {
    if (!documentState) return "";
    const relevantLedger = contextLedger.filter(
      (event) =>
        (activeThreadId && event.threadId === activeThreadId) ||
        event.type.startsWith("proposal") ||
        event.type === "thread_suggestion_decision"
    );
    const decisionLedger = contextLedger.filter(
      (event) =>
        event.type === "proposal_decision" ||
        event.type === "proposal_change_decision" ||
        event.type === "thread_suggestion_decision" ||
        event.type === "thread_status"
    );
    return JSON.stringify(
      {
        task: "Preview of the context packet Skribe sends to the agent for chat/thread turns.",
        document: {
          id: documentState.id ?? "default",
          title: documentState.review.title,
          words,
          draftPath: documentState.fileInfo?.draftPath,
          reviewPath: documentState.fileInfo?.reviewPath
        },
        activeThread,
        openThreads: openThreads(documentState.review.threads),
        resolvedThreadCount: documentState.review.threads.filter((thread) => thread.status === "resolved").length,
        openProposals: documentState.review.proposals
          .filter((proposal) => proposal.status === "open" || proposal.status === "reviewed")
          .map(summarizeOpenProposal),
        recentChat: documentState.review.chat.slice(-20),
        contextMemory: {
          recentLedger: contextLedger.slice(-50),
          relevantLedger: relevantLedger.slice(-35),
          decisionLedger: decisionLedger.slice(-50)
        },
        currentMarkdown: documentState.markdown
      },
      null,
      2
    );
  }

  if (!documentState) {
    return (
      <main className="loading-screen">
        <div className="loading-mark" />
        <p>Opening local writing workspace...</p>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${isLeftRailCollapsed ? "left-collapsed" : ""} ${
        isRightPanelCollapsed ? "right-collapsed" : ""
      }`}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>Skribe</strong>
            <span>Local Markdown review workbench</span>
          </div>
        </div>

        <input
          className="title-input"
          value={documentState.review.title}
          onChange={(event) => updateTitle(event.target.value)}
          aria-label="Document title"
        />

        <div className="topbar-actions">
          <span className={`save-pill is-${saveState}`}>
            {saveState === "saving" ? <RefreshCw size={14} /> : <Save size={14} />}
            {saveState}
          </span>
          {agentSession ? (
            <span className={`agent-pill is-${agentSession.status}`}>
              <Sparkles size={14} />
              {agentSession.status}
              {agentSession.queueDepth > 0 ? ` · ${agentSession.queueDepth}` : ""}
            </span>
          ) : null}
          <button className="icon-button" onClick={() => fileInputRef.current?.click()} title="Import Markdown">
            <Import size={17} />
          </button>
          <button className="icon-button" onClick={() => copyText(documentState.markdown, "Markdown copied")} title="Copy Markdown">
            <Copy size={17} />
          </button>
          <button className="icon-button" onClick={exportMarkdown} title="Export Markdown">
            <Download size={17} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importMarkdown(file);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail">
          <button
            className="rail-collapse-button"
            onClick={() => setIsLeftRailCollapsed((value) => !value)}
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

          <div className="rail-section file-paths">
            <div className="rail-heading">
              <SplitSquareVertical size={15} />
              Local files
            </div>
            <button onClick={() => copyText(documentState.fileInfo?.draftPath ?? "", "Draft path copied")}>
              draft.md
            </button>
            <button onClick={() => copyText(documentState.fileInfo?.reviewPath ?? "", "Review path copied")}>
              review.json
            </button>
            <button onClick={() => copyText(documentState.fileInfo?.sessionPath ?? "", "Session path copied")}>
              session.json
            </button>
            <button onClick={() => copyText(documentState.fileInfo?.eventsPath ?? "", "Events path copied")}>
              events.jsonl
            </button>
          </div>
          </div>
        </aside>

        <section className="center-pane">
          <div className="canvas-toolbar">
            <div className="canvas-mode-label">
              <FileText size={15} />
              Editable canvas
            </div>
            <div className="format-toolbar" aria-label="Formatting toolbar">
              <button title="Paragraph (Ctrl/Cmd+Alt+0)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "paragraph", level: undefined }); }}>
                <Pilcrow size={16} />
              </button>
              <button title="Heading 1 (Ctrl/Cmd+Alt+1)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "heading", level: 1 }); }}>
                <Heading1 size={16} />
              </button>
              <button title="Heading 2 (Ctrl/Cmd+Alt+2)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "heading", level: 2 }); }}>
                <Heading2 size={16} />
              </button>
              <button title="Heading 3 (Ctrl/Cmd+Alt+3)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "heading", level: 3 }); }}>
                <Heading3 size={16} />
              </button>
              <span className="toolbar-divider" />
              <button title="Bold (Ctrl/Cmd+B)" onMouseDown={(event) => { event.preventDefault(); applyInlineCommand("bold"); }}>
                <Bold size={16} />
              </button>
              <button title="Italic (Ctrl/Cmd+I)" onMouseDown={(event) => { event.preventDefault(); applyInlineCommand("italic"); }}>
                <Italic size={16} />
              </button>
              <button title="Inline code (Ctrl/Cmd+`)" onMouseDown={(event) => { event.preventDefault(); applyInlineCode(); }}>
                <Code2 size={16} />
              </button>
              <span className="toolbar-divider" />
              <button title="Bulleted list (Ctrl/Cmd+Shift+8)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "unordered-list" }); }}>
                <List size={16} />
              </button>
              <button title="Numbered list (Ctrl/Cmd+Shift+7)" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "ordered-list", marker: "1" }); }}>
                <ListOrdered size={16} />
              </button>
              <button title="Quote" disabled={!activeBlockId} onMouseDown={(event) => { event.preventDefault(); updateActiveBlockShape({ type: "quote" }); }}>
                <Quote size={16} />
              </button>
            </div>
            <div className="toolbar-hint">
              <Highlighter size={15} />
              Highlight to comment. Click text to edit.
            </div>
          </div>

          <article ref={canvasRef} className="markdown-canvas" onMouseUp={handleSelection}>
            <EditableMarkdownCanvas
              markdown={documentState.markdown}
              threads={threads}
              activeThreadId={activeThread?.id ?? null}
              onActivateThread={(threadId) => {
                setActiveThreadId(threadId);
                setPanelMode("threads");
              }}
              onUpdateBlock={updateCanvasBlock}
              onRegisterBlock={registerBlockRef}
              onFocusBlock={setActiveBlockId}
              onShortcut={handleEditorShortcut}
            />
          </article>
        </section>

        <aside className="right-panel">
          <button
            className="right-collapse-button"
            onClick={() => setIsRightPanelCollapsed((value) => !value)}
            title={isRightPanelCollapsed ? "Show right sidebar" : "Hide right sidebar"}
          >
            {isRightPanelCollapsed ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
          </button>
          <div className="right-panel-content">
          <div className="panel-tabs">
            <button className={panelMode === "threads" ? "active" : ""} onClick={() => setPanelMode("threads")}>
              <MessageSquare size={15} />
              Threads
            </button>
            <button className={panelMode === "chat" ? "active" : ""} onClick={() => setPanelMode("chat")}>
              <Sparkles size={15} />
              Chat
            </button>
          </div>

          {panelMode === "threads" ? (
            <ThreadPanel
              threads={threads}
              activeThread={activeThread}
              activeThreadId={activeThreadId}
              selectionDraft={selectionDraft}
              newComment={newComment}
              replyDrafts={replyDrafts}
              suggestionDrafts={suggestionDrafts}
              replyAuthor={replyAuthor}
              onSetReplyAuthor={setReplyAuthor}
              onSetNewComment={setNewComment}
              onAddThread={addThread}
              onClearSelection={() => {
                setSelectionDraft(null);
                window.getSelection()?.removeAllRanges();
              }}
              onActivateThread={setActiveThreadId}
              onSetReplyDrafts={setReplyDrafts}
              onSetSuggestionDrafts={setSuggestionDrafts}
              onAddMessage={addThreadMessage}
              onAddSuggestion={addSuggestion}
              onSetStatus={updateThreadStatus}
              onSuggestionStatus={updateSuggestionStatus}
              agentSession={agentSession}
            />
          ) : (
            <ChatPanel
              messages={documentState.review.chat}
              proposals={proposals}
              contextLedger={contextLedger}
              agentSession={agentSession}
              chatDraft={chatDraft}
              chatAuthor={chatAuthor}
              onSetChatDraft={setChatDraft}
              onSetChatAuthor={setChatAuthor}
              onSend={addChatMessage}
              onProposalStatus={updateProposalStatus}
              onProposalChangeDecision={updateProposalChangeDecision}
              onRequestProposalRevision={requestProposalRevision}
              onCopyAgentPacket={() => copyText(buildAgentPacket(), "Agent packet copied")}
            />
          )}
          </div>
        </aside>
      </section>

      {lastCopied ? <div className="toast">{lastCopied}</div> : null}
    </main>
  );
}

interface MarkdownCanvasProps {
  markdown: string;
  threads: ReviewThread[];
  activeThreadId: string | null;
  onActivateThread: (threadId: string) => void;
  onUpdateBlock: (blockId: string, text: string) => void;
  onRegisterBlock: (blockId: string, node: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
  onShortcut: (event: React.KeyboardEvent<HTMLElement>, blockId: string) => void;
}

function EditableMarkdownCanvas({
  markdown,
  threads,
  activeThreadId,
  onActivateThread,
  onUpdateBlock,
  onRegisterBlock,
  onFocusBlock,
  onShortcut
}: MarkdownCanvasProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);

  if (blocks.length === 0) {
    return <p className="editable-empty">Start writing...</p>;
  }

  return (
    <>
      {blocks.map((block) => (
        <EditableBlock
          key={block.id}
          block={block}
          threads={threads}
          activeThreadId={activeThreadId}
          onActivateThread={onActivateThread}
          onUpdateBlock={onUpdateBlock}
          onRegisterBlock={onRegisterBlock}
          onFocusBlock={onFocusBlock}
          onShortcut={onShortcut}
        />
      ))}
    </>
  );
}

function EditableBlock({
  block,
  threads,
  activeThreadId,
  onActivateThread,
  onUpdateBlock,
  onRegisterBlock,
  onFocusBlock,
  onShortcut
}: {
  block: ReturnType<typeof parseMarkdownBlocks>[number];
  threads: ReviewThread[];
  activeThreadId: string | null;
  onActivateThread: (threadId: string) => void;
  onUpdateBlock: (blockId: string, text: string) => void;
  onRegisterBlock: (blockId: string, node: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
  onShortcut: (event: React.KeyboardEvent<HTMLElement>, blockId: string) => void;
}) {
  const editableRef = useRef<HTMLElement | null>(null);

  function commitBlock() {
    const html = editableRef.current?.innerHTML.replace(/\u00a0/g, " ").trimEnd() ?? "";
    if (htmlToInlineMarkdown(html) !== block.text) onUpdateBlock(block.id, html);
  }

  const editableProps: any = {
    ref: (node: HTMLElement | null) => {
      editableRef.current = node;
      onRegisterBlock(block.id, node);
    },
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: true,
    onFocus: () => onFocusBlock(block.id),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => onShortcut(event, block.id),
    onBlur: commitBlock,
    className: "editable-text"
  };

  const children = renderHighlightedText(block.text, threads, activeThreadId, onActivateThread);

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

  return (
    <p {...editableProps} id={block.id}>
      {children}
    </p>
  );
}

function renderHighlightedText(
  text: string,
  threads: ReviewThread[],
  activeThreadId: string | null,
  onActivateThread: (threadId: string) => void
) {
  const ranges = threads
    .filter((thread) => thread.status === "open" && thread.anchor.exact)
    .map((thread) => {
      const index = text.indexOf(thread.anchor.exact);
      return index >= 0
        ? {
            thread,
            start: index,
            end: index + thread.anchor.exact.length
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a!.start - b!.start) as Array<{ thread: ReviewThread; start: number; end: number }>;

  if (ranges.length === 0) {
    return <span dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(text) }} />;
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor) return;
    if (range.start > cursor) {
      nodes.push(
        <span key={`segment-${cursor}`} dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(text.slice(cursor, range.start)) }} />
      );
    }
    const isActive = activeThreadId === range.thread.id;
    nodes.push(
      <span
        key={range.thread.id}
        className={`anchor-highlight ${isActive ? "is-active" : ""}`}
        onMouseDown={(event) => {
          event.preventDefault();
          onActivateThread(range.thread.id);
        }}
        dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(text.slice(range.start, range.end)) }}
      />
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    nodes.push(
      <span key={`segment-${cursor}`} dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(text.slice(cursor)) }} />
    );
  }
  return nodes;
}

interface ThreadPanelProps {
  threads: ReviewThread[];
  activeThread: ReviewThread | null;
  activeThreadId: string | null;
  selectionDraft: SelectionDraft | null;
  newComment: string;
  replyDrafts: Record<string, string>;
  suggestionDrafts: Record<string, string>;
  replyAuthor: Author;
  onSetReplyAuthor: (author: Author) => void;
  onSetNewComment: (value: string) => void;
  onAddThread: () => void;
  onClearSelection: () => void;
  onActivateThread: (threadId: string) => void;
  onSetReplyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSetSuggestionDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onAddMessage: (threadId: string) => void;
  onAddSuggestion: (thread: ReviewThread) => void;
  onSetStatus: (threadId: string, status: "open" | "resolved") => void;
  onSuggestionStatus: (threadId: string, suggestionId: string, status: "accepted" | "rejected") => void;
  agentSession?: AgentSession;
}

function ThreadPanel(props: ThreadPanelProps) {
  const {
    threads,
    activeThread,
    activeThreadId,
    selectionDraft,
    newComment,
    replyDrafts,
    suggestionDrafts,
    replyAuthor,
    onSetReplyAuthor,
    onSetNewComment,
    onAddThread,
    onClearSelection,
    onActivateThread,
    onSetReplyDrafts,
    onSetSuggestionDrafts,
    onAddMessage,
    onAddSuggestion,
    onSetStatus,
    onSuggestionStatus,
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
          <textarea
            value={newComment}
            onChange={(event) => onSetNewComment(event.target.value)}
            placeholder="Leave a note for the agent..."
            rows={4}
          />
          <div className="button-row">
            <button className="primary-button" onClick={onAddThread}>
              <MessageSquare size={15} />
              Add thread
            </button>
            <button className="ghost-button" onClick={onClearSelection}>
              <X size={15} />
              Clear
            </button>
          </div>
        </section>
      ) : null}

      <section className="thread-list">
        {threads.length === 0 ? (
          <p className="empty-note">Highlight text in the canvas to start the first review thread.</p>
        ) : (
          threads.map((thread, index) => (
            <button
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
            <button
              className="ghost-button small"
              onClick={() => onSetStatus(activeThread.id, activeThread.status === "open" ? "resolved" : "open")}
            >
              {activeThread.status === "open" ? "Resolve" : "Reopen"}
            </button>
          </div>
          <blockquote>{activeThread.anchor.exact}</blockquote>

          <div className="message-stack">
            {activeThread.messages.map((message) => (
              <article key={message.id} className={`message-bubble is-${message.author}`}>
                <div>
                  <strong>{authorLabels[message.author]}</strong>
                  <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                <p>{message.body}</p>
              </article>
            ))}
            {isAgentWorkingForActiveThread ? <AgentTypingIndicator label="Agent is drafting a thread reply" /> : null}
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
                      <button className="primary-button" onClick={() => onSuggestionStatus(activeThread.id, suggestion.id, "accepted")}>
                        <Check size={15} />
                        Accept
                      </button>
                      <button className="ghost-button" onClick={() => onSuggestionStatus(activeThread.id, suggestion.id, "rejected")}>
                        <X size={15} />
                        Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          <div className="composer">
            <div className="composer-toolbar">
              <label>
                Author
                <select value={replyAuthor} onChange={(event) => onSetReplyAuthor(event.target.value as Author)}>
                  <option value="human">Human</option>
                  <option value="agent">Agent</option>
                </select>
              </label>
            </div>
            <textarea
              value={replyDrafts[activeThread.id] ?? ""}
              onChange={(event) =>
                onSetReplyDrafts((drafts) => ({
                  ...drafts,
                  [activeThread.id]: event.target.value
                }))
              }
              rows={3}
              placeholder="Reply in this thread..."
            />
            <button className="primary-button" onClick={() => onAddMessage(activeThread.id)}>
              <Send size={15} />
              Reply
            </button>
          </div>

          <div className="composer suggestion-composer">
            <label>Agent replacement suggestion</label>
            <textarea
              value={suggestionDrafts[activeThread.id] ?? ""}
              onChange={(event) =>
                onSetSuggestionDrafts((drafts) => ({
                  ...drafts,
                  [activeThread.id]: event.target.value
                }))
              }
              rows={5}
              placeholder="Draft replacement text for the selected passage..."
            />
            <button className="secondary-button" onClick={() => onAddSuggestion(activeThread)}>
              <Sparkles size={15} />
              Save suggestion
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface ChatPanelProps {
  messages: ChatMessage[];
  proposals: DocumentProposal[];
  contextLedger: ContextLedgerEvent[];
  agentSession?: AgentSession;
  chatDraft: string;
  chatAuthor: Author;
  onSetChatDraft: (value: string) => void;
  onSetChatAuthor: (author: Author) => void;
  onSend: () => void;
  onProposalStatus: (proposalId: string, status: "accepted" | "rejected") => void;
  onProposalChangeDecision: (proposalId: string, changeKey: string, decision: ProposalChangeDecision) => void;
  onRequestProposalRevision: (proposalId: string, change: ProposalChangeBlock, instruction: string) => void;
  onCopyAgentPacket: () => void;
}

function ChatPanel({
  messages,
  proposals,
  contextLedger,
  agentSession,
  chatDraft,
  chatAuthor,
  onSetChatDraft,
  onSetChatAuthor,
  onSend,
  onProposalStatus,
  onProposalChangeDecision,
  onRequestProposalRevision,
  onCopyAgentPacket
}: ChatPanelProps) {
  const isAgentWorkingInChat = agentSession?.status === "running" && agentSession.activeTurn?.source === "chat";
  const openProposals = proposals.filter((proposal) => proposal.status === "open" || proposal.status === "reviewed");
  const recentLedger = contextLedger.slice(-5).reverse();
  const decisionCount = contextLedger.filter(
    (event) =>
      event.type === "proposal_decision" ||
      event.type === "proposal_change_decision" ||
      event.type === "thread_suggestion_decision"
  ).length;
  return (
    <div className="panel-body chat-panel">
      <div className="chat-actions">
        <button className="secondary-button" onClick={onCopyAgentPacket}>
          <Clipboard size={15} />
          Copy context packet
        </button>
      </div>

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
            <article key={message.id} className={`message-bubble is-${message.author}`}>
              <div>
                <strong>{authorLabels[message.author]}</strong>
                <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <p>{message.body}</p>
            </article>
          ))
        )}
        {isAgentWorkingInChat ? <AgentTypingIndicator label="Agent is drafting a reply" /> : null}
      </div>

      <div className="composer chat-composer">
        <div className="composer-toolbar">
          <label>
            Author
            <select value={chatAuthor} onChange={(event) => onSetChatAuthor(event.target.value as Author)}>
              <option value="human">Human</option>
              <option value="agent">Agent</option>
            </select>
          </label>
        </div>
        <textarea
          value={chatDraft}
          onChange={(event) => onSetChatDraft(event.target.value)}
          rows={5}
          placeholder="Discuss the draft, ask for a pass, or leave agent instructions..."
        />
        <button className="primary-button" onClick={onSend}>
          <Send size={15} />
          Send
        </button>
      </div>
    </div>
  );
}

function DocumentProposalCard({
  proposal,
  onProposalStatus,
  onProposalChangeDecision,
  onRequestProposalRevision
}: {
  proposal: DocumentProposal;
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
            diffStyle: "unified",
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

      {changes.length > 0 ? (
        <div className="proposal-change-list">
          {changes.map((change) => {
            const decision = decisions[change.key];
            const revisionDraft = revisionDrafts[change.key] ?? "";
            return (
              <section key={change.key} className={`proposal-change-block is-${decision ?? "pending"}`}>
                <div className="change-block-header">
                  <strong>Change {change.ordinal}</strong>
                  <span>
                    -{lineRangeLabel(change.deletionLineStart, change.deletions.length)} · +
                    {lineRangeLabel(change.additionLineStart, change.additions.length)}
                  </span>
                </div>
                <div className="change-block-preview">
                  <div>
                    <span>Original</span>
                    <pre>{trimBlockText(change.deletions).slice(0, 900)}</pre>
                  </div>
                  <div>
                    <span>Proposed</span>
                    <pre>{trimBlockText(change.additions).slice(0, 900)}</pre>
                  </div>
                </div>
                <div className="button-row">
                  <button
                    className={decision === "accepted" ? "primary-button" : "secondary-button"}
                    onClick={() => onProposalChangeDecision(proposal.id, change.key, "accepted")}
                  >
                    <Check size={15} />
                    Accept block
                  </button>
                  <button
                    className={decision === "rejected" ? "ghost-button is-active" : "ghost-button"}
                    onClick={() => onProposalChangeDecision(proposal.id, change.key, "rejected")}
                  >
                    <X size={15} />
                    Decline
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => setOpenRevisionKey(openRevisionKey === change.key ? null : change.key)}
                  >
                    <RefreshCw size={15} />
                    Revise
                  </button>
                </div>
                {openRevisionKey === change.key ? (
                  <div className="revision-composer">
                    <textarea
                      value={revisionDraft}
                      onChange={(event) =>
                        setRevisionDrafts((drafts) => ({
                          ...drafts,
                          [change.key]: event.target.value
                        }))
                      }
                      rows={3}
                      placeholder="Tell the agent what to change about this block..."
                    />
                    <button
                      className="primary-button"
                      onClick={() => {
                        onRequestProposalRevision(proposal.id, change, revisionDraft);
                        setOpenRevisionKey(null);
                        setRevisionDrafts((drafts) => ({ ...drafts, [change.key]: "" }));
                      }}
                    >
                      <Send size={15} />
                      Request revision
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
        <button className="primary-button" onClick={() => onProposalStatus(proposal.id, "accepted")}>
          <Check size={15} />
          Accept all
        </button>
        <button className="ghost-button" onClick={() => onProposalStatus(proposal.id, "rejected")}>
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
