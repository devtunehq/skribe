import type { AgentRuntimeConfig, AgentSession } from "./types";

export const AGENT_RUNTIME_UNAVAILABLE_LABEL = "No agent runtime";
export const AGENT_RUNTIME_UNAVAILABLE_TITLE =
  "No agent runtime detected. Install Codex CLI, Claude Code, or start a local inference server, then run skribe doctor.";
export const AGENT_RUNTIME_UNAVAILABLE_MESSAGE =
  "No agent runtime detected. Install or sign in to Codex CLI or Claude Code, start a local inference server (Ollama, LM Studio, or llama.cpp), then run ";
export const AGENT_RUNTIME_UNAVAILABLE_SHORT = "No agent runtime detected. Run skribe doctor.";

export function effectiveRuntimeId(
  configuredRuntime: string,
  resolvedRuntime: string | null | undefined
) {
  return configuredRuntime === "auto" ? resolvedRuntime ?? null : configuredRuntime;
}

export function providerSelectValue(
  configuredRuntime: string,
  resolvedRuntime: string | null | undefined,
  providerOptions: AgentRuntimeConfig["runtimes"]
) {
  if (configuredRuntime === "auto") return "auto";
  if (providerOptions.some((runtime) => runtime.id === configuredRuntime)) return configuredRuntime;
  if (providerOptions.some((runtime) => runtime.id === resolvedRuntime)) return resolvedRuntime ?? "";
  return "";
}

export function selectedRuntimeDisplayLabel(options: {
  agentRuntimeUnavailable: boolean;
  configuredRuntime: string;
  runtimeLabel?: string | null;
}) {
  if (options.agentRuntimeUnavailable) return AGENT_RUNTIME_UNAVAILABLE_LABEL;
  const runtimeLabel = options.runtimeLabel ?? "Agent";
  if (options.configuredRuntime === "auto") return `Auto (${runtimeLabel})`;
  return runtimeLabel;
}

export function agentModelDraftFromConfiguredModel(model?: string | null) {
  return !model || model === "auto" ? "" : model;
}

export function modelIsAdvertisedByDifferentRuntime(
  model: string,
  runtimeId: string | null | undefined,
  runtimes: AgentRuntimeConfig["runtimes"]
) {
  if (!model || model === "auto" || !runtimeId) return false;

  const runtimesAdvertisingModel = runtimes.filter((runtime) => runtime.models.some((option) => option.id === model));
  if (runtimesAdvertisingModel.length === 0) return false;

  return !runtimesAdvertisingModel.some((runtime) => runtime.id === runtimeId);
}

export function mergeRuntimeConfigFromSession(
  current: AgentRuntimeConfig | null,
  session?: AgentSession | null
): AgentRuntimeConfig | null {
  if (!current || !session) return current;

  return {
    ...current,
    configuredRuntime: session.configuredRuntime ?? current.configuredRuntime,
    resolvedRuntime: session.runtime ?? current.resolvedRuntime,
    configuredModel: session.configuredModel ?? current.configuredModel,
    resolvedModel: session.model ?? current.resolvedModel,
    configuredEffort: session.configuredEffort ?? current.configuredEffort,
    resolvedEffort: session.effort ?? current.resolvedEffort
  };
}
