import assert from "node:assert/strict";
import test from "node:test";

import {
  appControllerReducer,
  createAppControllerSetters,
  createAppControllerState
} from "../src/appControllerState.ts";

const defaultSettings = {
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

test("app controller state initializes editor, settings, and panel defaults", () => {
  const state = createAppControllerState(defaultSettings);

  assert.equal(state.documentState, null);
  assert.equal(state.appSettings, defaultSettings);
  assert.equal(state.settingsDraft, defaultSettings);
  assert.equal(state.saveState, "loading");
  assert.equal(state.settingsSaveState, "saved");
  assert.equal(state.panelMode, "threads");
  assert.deepEqual(state.revisionState, { revisions: [], currentRevisionId: null });
  assert.deepEqual(state.replyDrafts, {});
  assert.deepEqual(state.blockResetKeys, {});
});

test("app controller reducer patches independent state clusters", () => {
  const state = createAppControllerState(defaultSettings);
  const next = appControllerReducer(state, {
    type: "patch",
    patch: {
      isSettingsOpen: true,
      panelMode: "chat",
      saveState: "saving"
    }
  });

  assert.equal(next.isSettingsOpen, true);
  assert.equal(next.panelMode, "chat");
  assert.equal(next.saveState, "saving");
  assert.equal(next.appSettings, defaultSettings);
  assert.equal(state.isSettingsOpen, false);
});

test("app controller setters support React-style functional updates", () => {
  let state = createAppControllerState(defaultSettings);
  const dispatch = (action) => {
    state = appControllerReducer(state, action);
  };
  const setters = createAppControllerSetters(dispatch);

  setters.setReplyDrafts((drafts) => ({ ...drafts, thread_1: "Reply" }));
  setters.setBlockResetKeys((keys) => ({ ...keys, block_1: (keys.block_1 ?? 0) + 1 }));
  setters.setBlockResetKeys((keys) => ({ ...keys, block_1: (keys.block_1 ?? 0) + 1 }));
  setters.setPanelMode("chat");

  assert.deepEqual(state.replyDrafts, { thread_1: "Reply" });
  assert.deepEqual(state.blockResetKeys, { block_1: 2 });
  assert.equal(state.panelMode, "chat");
});
