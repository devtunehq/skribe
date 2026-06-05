export type Author = "human" | "agent";

export type ThreadStatus = "open" | "resolved";

export type SuggestionStatus = "open" | "accepted" | "rejected";

export type SuggestionType = "replace" | "insert" | "delete";

export type ProposalStatus = "open" | "accepted" | "rejected" | "reviewed";

export type ProposalChangeDecision = "accepted" | "rejected";

export type EditorLanguage = "en-GB" | "en-US";

export type ProposalModeDefault = "conservative" | "bold";

export type DocumentFont = "default" | "sans" | "serif" | "mono";

export type AppTheme = "default" | "newsprint" | "sage" | "coral" | "graphite";

export type ToneSetupMode = "manual" | "interview" | "links" | "archetype";

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

export interface AppSettings {
  version: number;
  toneOfVoice: string;
  toneOfVoiceSetupComplete: boolean;
  editorLanguage: EditorLanguage;
  documentFont: DocumentFont;
  theme: AppTheme;
  agentRuntime: string;
  agentModel: string;
  agentEffort: string;
  defaultSkills: string[];
  autoReplyToComments: boolean;
  showResolvedThreads: boolean;
  panelState: {
    leftCollapsed: boolean;
    rightCollapsed: boolean;
  };
  proposalModeDefault: ProposalModeDefault;
  updatedAt?: string;
}

export interface SettingsResponse {
  settings: AppSettings;
  storage?: {
    configDir: string;
    dataDir: string;
    settingsPath: string;
  };
}

export interface ToneGenerateRequest {
  mode: ToneSetupMode;
  manualText?: string;
  interviewAnswers?: string[];
  urls?: string[];
  archetypeId?: string;
  editorLanguage?: EditorLanguage;
}

export interface ToneGenerateResponse {
  toneOfVoice: string;
  sourceCount: number;
  warnings: string[];
}

export interface ToneInterviewMessage {
  role: Author;
  body: string;
}

export interface ToneInterviewRequest {
  messages: ToneInterviewMessage[];
  editorLanguage?: EditorLanguage;
  currentTone?: string;
  forceGenerate?: boolean;
}

export interface ToneInterviewResponse {
  status: "asking" | "ready";
  reply: string;
  toneOfVoice: string;
  warnings: string[];
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
  effort?: string | null;
  configuredEffort?: string;
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
  description?: string;
}

export interface AgentRuntimeEffort {
  id: string;
  label: string;
  source?: string;
  description?: string;
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
  supportsEffort: boolean;
  effortLevels: AgentRuntimeEffort[];
  defaultEffort: string | null;
  notes: string[];
}

export interface AgentRuntimeConfig {
  configuredRuntime: string;
  resolvedRuntime: string | null;
  configuredModel: string;
  resolvedModel: string | null;
  configuredEffort: string;
  resolvedEffort: string | null;
  runtimes: AgentRuntimeStatus[];
}

export interface AgentMessageRequest {
  source: "chat" | "thread";
  body: string;
  threadId?: string | null;
  document: DocumentState;
  skills?: AgentSkillSelection[];
}
