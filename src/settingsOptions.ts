import type {
  AppTheme,
  DiffViewMode,
  DocumentFont,
  EditorLanguage,
  ToneSetupMode
} from "./types";

export type SettingsTab = "writing" | "agent" | "workspace";

export const editorLanguageOptions: Array<{ value: EditorLanguage; label: string }> = [
  { value: "en-GB", label: "EN-GB" },
  { value: "en-US", label: "EN-US" }
];

export const documentFontOptions: Array<{ value: DocumentFont; label: string; description: string }> = [
  { value: "default", label: "Skribe default", description: "Mono headings, clean sans body." },
  { value: "sans", label: "Clean sans", description: "Sans throughout the document." },
  { value: "serif", label: "Editorial serif", description: "Warmer long-form reading." },
  { value: "mono", label: "Mono draft", description: "Technical, precise drafting." }
];

export const appThemeOptions: Array<{ value: AppTheme; label: string; description: string }> = [
  { value: "default", label: "Skribe", description: "Oat paper, yellow mark, blue actions." },
  { value: "newsprint", label: "Newsprint", description: "Quiet editorial monochrome with red notes." },
  { value: "sage", label: "Sage", description: "Soft green workspace with mint actions." },
  { value: "coral", label: "Coral", description: "Warm paper, coral accents, blue links." },
  { value: "graphite", label: "Graphite", description: "Dark desk, bright controls." }
];

export const diffViewModeOptions: Array<{ value: DiffViewMode; label: string; description: string }> = [
  { value: "split", label: "Split", description: "Show current and proposed text side by side." },
  { value: "unified", label: "Unified", description: "Show removals and additions in one compact flow." }
];

export const settingsTabOptions: Array<{ id: SettingsTab; label: string }> = [
  { id: "writing", label: "Writing" },
  { id: "agent", label: "Agent" },
  { id: "workspace", label: "Workspace" }
];

export const toneSetupModes: Array<{ id: ToneSetupMode; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "interview", label: "Interview" },
  { id: "links", label: "Links" },
  { id: "archetype", label: "Archetypes" }
];

export const toneLinkSlots = [
  { id: "tone-link-1", label: "Link 1", position: 0 },
  { id: "tone-link-2", label: "Link 2", position: 1 },
  { id: "tone-link-3", label: "Link 3", position: 2 },
  { id: "tone-link-4", label: "Link 4", position: 3 },
  { id: "tone-link-5", label: "Link 5", position: 4 }
];

export const toneArchetypeOptions = [
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
