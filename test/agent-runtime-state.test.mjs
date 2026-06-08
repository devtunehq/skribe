import assert from "node:assert/strict";
import test from "node:test";

import {
  agentModelDraftFromConfiguredModel,
  mergeRuntimeConfigFromSession,
  modelIsAdvertisedByDifferentRuntime
} from "../src/agentRuntimeState.ts";

const runtimeConfig = {
  configuredRuntime: "codex",
  resolvedRuntime: "codex",
  configuredModel: "gpt-5-codex",
  resolvedModel: "gpt-5-codex",
  configuredEffort: "high",
  resolvedEffort: "high",
  runtimes: [
    {
      id: "codex",
      label: "Codex CLI",
      available: true,
      version: "1.0.0",
      supportsModelFlag: true,
      supportsStructuredOutput: true,
      supportsManualModel: true,
      models: [{ id: "gpt-5-codex", label: "GPT-5 Codex" }],
      defaultModel: "gpt-5-codex",
      supportsEffort: true,
      effortLevels: [{ id: "high", label: "High" }],
      defaultEffort: "high",
      notes: []
    },
    {
      id: "claude",
      label: "Claude Code",
      available: true,
      version: "2.0.0",
      supportsModelFlag: true,
      supportsStructuredOutput: true,
      supportsManualModel: true,
      models: [{ id: "opus", label: "Opus" }],
      defaultModel: "sonnet",
      supportsEffort: false,
      effortLevels: [],
      defaultEffort: null,
      notes: []
    }
  ]
};

test("agent model draft is empty for auto and mirrors manual model ids", () => {
  assert.equal(agentModelDraftFromConfiguredModel("auto"), "");
  assert.equal(agentModelDraftFromConfiguredModel(null), "");
  assert.equal(agentModelDraftFromConfiguredModel("opus"), "opus");
});

test("model ownership check only flags models advertised by another runtime", () => {
  assert.equal(modelIsAdvertisedByDifferentRuntime("gpt-5-codex", "codex", runtimeConfig.runtimes), false);
  assert.equal(modelIsAdvertisedByDifferentRuntime("gpt-5-codex", "claude", runtimeConfig.runtimes), true);
  assert.equal(modelIsAdvertisedByDifferentRuntime("unknown-custom-model", "claude", runtimeConfig.runtimes), false);
  assert.equal(modelIsAdvertisedByDifferentRuntime("auto", "claude", runtimeConfig.runtimes), false);
});

test("runtime config merges live agent session fields without losing detected options", () => {
  const merged = mergeRuntimeConfigFromSession(runtimeConfig, {
    id: "session",
    runtime: "claude",
    configuredRuntime: "claude",
    model: "opus",
    configuredModel: "opus",
    effort: null,
    configuredEffort: "auto",
    status: "idle",
    turnCount: 2,
    queueDepth: 0,
    activeTurn: null,
    lastRunAt: null,
    lastError: null,
    updatedAt: "2026-06-08T10:00:00.000Z"
  });

  assert.equal(merged?.configuredRuntime, "claude");
  assert.equal(merged?.resolvedRuntime, "claude");
  assert.equal(merged?.configuredModel, "opus");
  assert.equal(merged?.resolvedModel, "opus");
  assert.equal(merged?.configuredEffort, "auto");
  assert.equal(merged?.resolvedEffort, "high");
  assert.equal(merged?.runtimes, runtimeConfig.runtimes);
});
