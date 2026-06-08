import assert from "node:assert/strict";
import test from "node:test";

import {
  createToneSetupState,
  toneSetupReducer
} from "../src/toneSetupState.ts";

test("tone setup state initializes from an existing tone profile", () => {
  const state = createToneSetupState("Direct, British English.", "operator");

  assert.equal(state.mode, "manual");
  assert.equal(state.manualText, "Direct, British English.");
  assert.equal(state.generatedTone, "Direct, British English.");
  assert.equal(state.selectedArchetypeId, "operator");
  assert.deepEqual(state.urls, ["", "", "", "", ""]);
});

test("tone setup state starts with interview mode when no tone exists", () => {
  const state = createToneSetupState("", "operator");

  assert.equal(state.mode, "interview");
  assert.equal(state.manualText, "");
  assert.equal(state.generatedTone, "");
});

test("tone setup reducer updates field state without mutating the previous state", () => {
  const state = createToneSetupState("", "operator");
  const withUrl = toneSetupReducer(state, { type: "set-url", position: 2, value: "https://example.com/post" });
  const withMode = toneSetupReducer(withUrl, { type: "set-mode", mode: "links" });

  assert.equal(state.urls[2], "");
  assert.equal(withUrl.urls[2], "https://example.com/post");
  assert.equal(withMode.mode, "links");
  assert.notEqual(withUrl.urls, state.urls);
});

test("tone setup reducer records interview and generation outcomes", () => {
  const state = createToneSetupState("", "operator");
  const thinking = toneSetupReducer(state, { type: "interview-request-start" });
  const completed = toneSetupReducer(thinking, {
    type: "interview-request-success",
    messages: [{ role: "agent", body: "Who do you write for?" }],
    toneOfVoice: "Write with practical specificity.",
    warnings: ["One link could not be read."]
  });
  const generated = toneSetupReducer(completed, {
    type: "tone-generation-success",
    toneOfVoice: "Manual profile.",
    warnings: [],
    syncManualText: true
  });

  assert.equal(thinking.interviewState, "thinking");
  assert.equal(completed.interviewState, "idle");
  assert.equal(completed.generatedTone, "Write with practical specificity.");
  assert.deepEqual(completed.warnings, ["One link could not be read."]);
  assert.equal(generated.manualText, "Manual profile.");
  assert.equal(generated.generatedTone, "Manual profile.");
});

