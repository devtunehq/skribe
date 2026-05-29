export type Author = "human" | "agent";

export type ThreadStatus = "open" | "resolved";

export type SuggestionStatus = "open" | "accepted" | "rejected";

export type SuggestionType = "replace" | "insert" | "delete";

export type ProposalStatus = "open" | "accepted" | "rejected" | "reviewed";

export type ProposalChangeDecision = "accepted" | "rejected";

export type ContextLedgerEventType =
  | "chat_message"
  | "thread_created"
  | "thread_message"
  | "thread_status"
  | "thread_suggestion_created"
  | "thread_suggestion_decision"
  | "proposal_created"
  | "proposal_decision"
  | "proposal_change_decision"
  | "proposal_revision_requested"
  | "document_imported"
  | "agent_reply";

export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface ThreadMessage {
  id: string;
  author: Author;
  body: string;
  createdAt: string;
}

export interface Suggestion {
  id: string;
  threadId: string;
  type: SuggestionType;
  original: string;
  replacement: string;
  status: SuggestionStatus;
  author: Author;
  createdAt: string;
}

export interface ReviewThread {
  id: string;
  status: ThreadStatus;
  anchor: Anchor;
  messages: ThreadMessage[];
  suggestions: Suggestion[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  author: Author;
  body: string;
  createdAt: string;
}

export interface DocumentProposal {
  id: string;
  source: "chat" | "thread";
  threadId?: string | null;
  title: string;
  summary: string;
  originalMarkdown: string;
  replacementMarkdown: string;
  status: ProposalStatus;
  changeDecisions?: Record<string, ProposalChangeDecision>;
  author: Author;
  createdAt: string;
}

export interface ContextLedgerEvent {
  id: string;
  type: ContextLedgerEventType;
  actor: Author;
  summary: string;
  createdAt: string;
  threadId?: string | null;
  proposalId?: string | null;
  changeKey?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewState {
  version: number;
  title: string;
  threads: ReviewThread[];
  chat: ChatMessage[];
  proposals: DocumentProposal[];
  contextLedger: ContextLedgerEvent[];
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  runtime: string;
  status: "idle" | "running" | "error";
  turnCount: number;
  queueDepth: number;
  activeTurn: {
    id: string;
    source: "chat" | "thread";
    threadId?: string | null;
    createdAt: string;
  } | null;
  lastRunAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface FileInfo {
  draftPath: string;
  reviewPath: string;
  sessionPath?: string;
  eventsPath?: string;
  draftUpdatedAt: string;
  reviewUpdatedAt: string;
}

export interface DocumentState {
  id?: string;
  markdown: string;
  review: ReviewState;
  agentSession?: AgentSession;
  fileInfo?: FileInfo;
}

export interface SelectionDraft {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface AgentMessageRequest {
  source: "chat" | "thread";
  body: string;
  threadId?: string | null;
  document: DocumentState;
}
