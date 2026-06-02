export type Author = "human" | "agent";

export type ThreadStatus = "open" | "resolved";

export type SuggestionStatus = "open" | "accepted" | "rejected";

export type SuggestionType = "replace" | "insert" | "delete";

export type ProposalStatus = "open" | "accepted" | "rejected" | "reviewed";

export type ProposalChangeDecision = "accepted" | "rejected";

export type EditorLanguage = "en-GB" | "en-US";

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
  | "document_revision_restored"
  | "agent_reply";

export interface Anchor {
  kind?: "markdown-range";
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
  skills?: AgentSkillSelection[];
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
  skills?: AgentSkillSelection[];
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

export interface ReviewSettings {
  editorLanguage: EditorLanguage;
}

export interface ReviewState {
  version: number;
  title: string;
  settings: ReviewSettings;
  threads: ReviewThread[];
  chat: ChatMessage[];
  proposals: DocumentProposal[];
  contextLedger: ContextLedgerEvent[];
  updatedAt: string;
}

export interface AgentSession {
  id: string;
  runtime: string;
  configuredRuntime?: string;
  model?: string | null;
  configuredModel?: string;
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
  docId: string;
  source: "internal" | "external";
  title: string;
  markdownPath: string;
  displayPath: string;
  docDir: string;
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

export interface DocumentRevision {
  id: string;
  parentId: string | null;
  createdAt: string;
  reason: string;
  title: string;
  words: number;
  hash: string;
}

export interface RevisionState {
  revisions: DocumentRevision[];
  currentRevisionId: string | null;
}

export interface SelectionDraft {
  kind?: "markdown-range";
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  source: string;
}

export interface AgentSkillSelection {
  id: string;
  name: string;
  description?: string;
  source?: string;
}

export interface AgentRuntimeModel {
  id: string;
  label: string;
  source?: string;
}

export interface AgentRuntimeStatus {
  id: string;
  label: string;
  command?: string | null;
  available: boolean;
  version: string | null;
  supportsModelFlag: boolean;
  supportsStructuredOutput: boolean;
  supportsManualModel: boolean;
  models: AgentRuntimeModel[];
  defaultModel: string | null;
  notes: string[];
}

export interface AgentRuntimeConfig {
  configuredRuntime: string;
  resolvedRuntime: string | null;
  configuredModel: string;
  resolvedModel: string | null;
  runtimes: AgentRuntimeStatus[];
}

export interface AgentMessageRequest {
  source: "chat" | "thread";
  body: string;
  threadId?: string | null;
  document: DocumentState;
  skills?: AgentSkillSelection[];
}
