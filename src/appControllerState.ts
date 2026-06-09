import type { Dispatch, SetStateAction } from "react";
import type {
  AgentRuntimeConfig,
  AgentSkill,
  AppSettings,
  DocumentState,
  RevisionState,
  SelectionDraft
} from "./types";

export type PanelMode = "threads" | "chat";
export type SaveState = "loading" | "saved" | "saving" | "error";
export type ToneSetupInvocation = "first-run" | "settings";
export type FirstRunStep = "agent" | "tone";

export type FloatingToolbarState = {
  left: number;
  top: number;
  placement: "above" | "below";
};

export type LinkPopoverState = {
  left: number;
  top: number;
};

export type SelectionContextMenuState = {
  left: number;
  top: number;
  hasSelection: boolean;
};

export interface AppControllerState {
  documentState: DocumentState | null;
  appSettings: AppSettings;
  settingsDraft: AppSettings;
  isSettingsOpen: boolean;
  firstRunStep: FirstRunStep | null;
  toneSetupInvocation: ToneSetupInvocation | null;
  settingsSaveState: SaveState;
  revisionState: RevisionState;
  agentSkills: AgentSkill[];
  agentRuntimeConfig: AgentRuntimeConfig | null;
  agentModelDraft: string;
  isAgentConfigOpen: boolean;
  isAgentModelMenuOpen: boolean;
  saveState: SaveState;
  panelMode: PanelMode;
  activeThreadId: string | null;
  activeBlockId: string | null;
  isLeftRailCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  isRestoringRevision: boolean;
  isRevisionHistoryOpen: boolean;
  selectionDraft: SelectionDraft | null;
  pendingSelectionDraft: SelectionDraft | null;
  newComment: string;
  replyDrafts: Record<string, string>;
  newThreadSkillIds: string[];
  threadSkillIds: Record<string, string[]>;
  chatDraft: string;
  chatSkillIds: string[];
  floatingToolbar: FloatingToolbarState | null;
  linkPopover: LinkPopoverState | null;
  selectionContextMenu: SelectionContextMenuState | null;
  linkDraft: string;
  lastCopied: string | null;
  blockResetKeys: Record<string, number>;
}

export type AppControllerStateKey = keyof AppControllerState;

export type AppControllerAction =
  | { type: "set"; key: AppControllerStateKey; value: unknown }
  | { type: "patch"; patch: Partial<AppControllerState> };

export function createAppControllerState(defaultSettings: AppSettings): AppControllerState {
  return {
    documentState: null,
    appSettings: defaultSettings,
    settingsDraft: defaultSettings,
    isSettingsOpen: false,
    firstRunStep: null,
    toneSetupInvocation: null,
    settingsSaveState: "saved",
    revisionState: { revisions: [], currentRevisionId: null },
    agentSkills: [],
    agentRuntimeConfig: null,
    agentModelDraft: "",
    isAgentConfigOpen: false,
    isAgentModelMenuOpen: false,
    saveState: "loading",
    panelMode: "threads",
    activeThreadId: null,
    activeBlockId: null,
    isLeftRailCollapsed: false,
    isRightPanelCollapsed: false,
    isRestoringRevision: false,
    isRevisionHistoryOpen: false,
    selectionDraft: null,
    pendingSelectionDraft: null,
    newComment: "",
    replyDrafts: {},
    newThreadSkillIds: [],
    threadSkillIds: {},
    chatDraft: "",
    chatSkillIds: [],
    floatingToolbar: null,
    linkPopover: null,
    selectionContextMenu: null,
    linkDraft: "",
    lastCopied: null,
    blockResetKeys: {}
  };
}

export function appControllerReducer(state: AppControllerState, action: AppControllerAction): AppControllerState {
  switch (action.type) {
    case "set": {
      const currentValue = state[action.key];
      const nextValue = typeof action.value === "function"
        ? (action.value as (current: unknown) => unknown)(currentValue)
        : action.value;
      if (Object.is(currentValue, nextValue)) return state;
      return {
        ...state,
        [action.key]: nextValue
      };
    }
    case "patch":
      return {
        ...state,
        ...action.patch
      };
    default:
      return state;
  }
}

function controllerSetter<K extends AppControllerStateKey>(
  dispatch: Dispatch<AppControllerAction>,
  key: K
): Dispatch<SetStateAction<AppControllerState[K]>> {
  return (value) => dispatch({ type: "set", key, value });
}

export function createAppControllerSetters(dispatch: Dispatch<AppControllerAction>) {
  return {
    setDocumentState: controllerSetter(dispatch, "documentState"),
    setAppSettings: controllerSetter(dispatch, "appSettings"),
    setSettingsDraft: controllerSetter(dispatch, "settingsDraft"),
    setIsSettingsOpen: controllerSetter(dispatch, "isSettingsOpen"),
    setFirstRunStep: controllerSetter(dispatch, "firstRunStep"),
    setToneSetupInvocation: controllerSetter(dispatch, "toneSetupInvocation"),
    setSettingsSaveState: controllerSetter(dispatch, "settingsSaveState"),
    setRevisionState: controllerSetter(dispatch, "revisionState"),
    setAgentSkills: controllerSetter(dispatch, "agentSkills"),
    setAgentRuntimeConfig: controllerSetter(dispatch, "agentRuntimeConfig"),
    setAgentModelDraft: controllerSetter(dispatch, "agentModelDraft"),
    setIsAgentConfigOpen: controllerSetter(dispatch, "isAgentConfigOpen"),
    setIsAgentModelMenuOpen: controllerSetter(dispatch, "isAgentModelMenuOpen"),
    setSaveState: controllerSetter(dispatch, "saveState"),
    setPanelMode: controllerSetter(dispatch, "panelMode"),
    setActiveThreadId: controllerSetter(dispatch, "activeThreadId"),
    setActiveBlockId: controllerSetter(dispatch, "activeBlockId"),
    setIsLeftRailCollapsed: controllerSetter(dispatch, "isLeftRailCollapsed"),
    setIsRightPanelCollapsed: controllerSetter(dispatch, "isRightPanelCollapsed"),
    setIsRestoringRevision: controllerSetter(dispatch, "isRestoringRevision"),
    setIsRevisionHistoryOpen: controllerSetter(dispatch, "isRevisionHistoryOpen"),
    setSelectionDraft: controllerSetter(dispatch, "selectionDraft"),
    setPendingSelectionDraft: controllerSetter(dispatch, "pendingSelectionDraft"),
    setNewComment: controllerSetter(dispatch, "newComment"),
    setReplyDrafts: controllerSetter(dispatch, "replyDrafts"),
    setNewThreadSkillIds: controllerSetter(dispatch, "newThreadSkillIds"),
    setThreadSkillIds: controllerSetter(dispatch, "threadSkillIds"),
    setChatDraft: controllerSetter(dispatch, "chatDraft"),
    setChatSkillIds: controllerSetter(dispatch, "chatSkillIds"),
    setFloatingToolbar: controllerSetter(dispatch, "floatingToolbar"),
    setLinkPopover: controllerSetter(dispatch, "linkPopover"),
    setSelectionContextMenu: controllerSetter(dispatch, "selectionContextMenu"),
    setLinkDraft: controllerSetter(dispatch, "linkDraft"),
    setLastCopied: controllerSetter(dispatch, "lastCopied"),
    setBlockResetKeys: controllerSetter(dispatch, "blockResetKeys")
  };
}
