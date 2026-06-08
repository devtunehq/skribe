import type { ToneInterviewMessage, ToneSetupMode } from "./types";

export type ToneInterviewState = "idle" | "thinking" | "error";
export type ToneBuilderState = "idle" | "generating" | "saving" | "error";

export interface ToneSetupState {
  mode: ToneSetupMode;
  manualText: string;
  interviewMessages: ToneInterviewMessage[];
  interviewDraft: string;
  interviewState: ToneInterviewState;
  urls: string[];
  selectedArchetypeId: string;
  generatedTone: string;
  warnings: string[];
  builderState: ToneBuilderState;
  errorMessage: string;
}

export type ToneSetupAction =
  | { type: "set-mode"; mode: ToneSetupMode }
  | { type: "set-manual-text"; value: string }
  | { type: "set-interview-messages"; messages: ToneInterviewMessage[] }
  | { type: "set-interview-draft"; value: string }
  | { type: "set-url"; position: number; value: string }
  | { type: "set-selected-archetype"; archetypeId: string }
  | { type: "set-generated-tone"; value: string }
  | { type: "set-builder-state"; builderState: ToneBuilderState }
  | { type: "set-error-message"; errorMessage: string }
  | { type: "clear-transient-feedback" }
  | { type: "interview-request-start" }
  | {
      type: "interview-request-success";
      messages: ToneInterviewMessage[];
      toneOfVoice?: string;
      warnings: string[];
    }
  | { type: "interview-request-error"; errorMessage: string }
  | { type: "restart-interview" }
  | { type: "tone-generation-start" }
  | {
      type: "tone-generation-success";
      toneOfVoice: string;
      warnings: string[];
      syncManualText?: boolean;
    }
  | { type: "tone-generation-error"; errorMessage: string }
  | { type: "tone-saving-start" };

export function createToneSetupState(currentTone: string, defaultArchetypeId = "direct-founder"): ToneSetupState {
  return {
    mode: currentTone.trim() ? "manual" : "interview",
    manualText: currentTone,
    interviewMessages: [],
    interviewDraft: "",
    interviewState: "idle",
    urls: Array.from({ length: 5 }, () => ""),
    selectedArchetypeId: defaultArchetypeId,
    generatedTone: currentTone,
    warnings: [],
    builderState: "idle",
    errorMessage: ""
  };
}

export function toneSetupReducer(state: ToneSetupState, action: ToneSetupAction): ToneSetupState {
  switch (action.type) {
    case "set-mode":
      return {
        ...state,
        mode: action.mode,
        warnings: [],
        errorMessage: ""
      };
    case "set-manual-text":
      return {
        ...state,
        manualText: action.value
      };
    case "set-interview-messages":
      return {
        ...state,
        interviewMessages: action.messages
      };
    case "set-interview-draft":
      return {
        ...state,
        interviewDraft: action.value
      };
    case "set-url":
      return {
        ...state,
        urls: state.urls.map((url, urlIndex) => (urlIndex === action.position ? action.value : url))
      };
    case "set-selected-archetype":
      return {
        ...state,
        selectedArchetypeId: action.archetypeId,
        generatedTone: ""
      };
    case "set-generated-tone":
      return {
        ...state,
        generatedTone: action.value
      };
    case "set-builder-state":
      return {
        ...state,
        builderState: action.builderState
      };
    case "set-error-message":
      return {
        ...state,
        errorMessage: action.errorMessage
      };
    case "clear-transient-feedback":
      return {
        ...state,
        warnings: [],
        errorMessage: ""
      };
    case "interview-request-start":
      return {
        ...state,
        interviewState: "thinking",
        warnings: [],
        errorMessage: ""
      };
    case "interview-request-success":
      return {
        ...state,
        interviewState: "idle",
        interviewMessages: action.messages,
        generatedTone: action.toneOfVoice ?? state.generatedTone,
        warnings: action.warnings
      };
    case "interview-request-error":
      return {
        ...state,
        interviewState: "error",
        errorMessage: action.errorMessage
      };
    case "restart-interview":
      return {
        ...state,
        interviewMessages: [],
        interviewDraft: "",
        generatedTone: "",
        warnings: [],
        errorMessage: "",
        interviewState: "idle"
      };
    case "tone-generation-start":
      return {
        ...state,
        builderState: "generating",
        warnings: [],
        errorMessage: ""
      };
    case "tone-generation-success":
      return {
        ...state,
        builderState: "idle",
        generatedTone: action.toneOfVoice,
        manualText: action.syncManualText ? action.toneOfVoice : state.manualText,
        warnings: action.warnings
      };
    case "tone-generation-error":
      return {
        ...state,
        builderState: "error",
        errorMessage: action.errorMessage
      };
    case "tone-saving-start":
      return {
        ...state,
        builderState: "saving"
      };
    default:
      return state;
  }
}

