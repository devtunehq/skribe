import type { AgentRuntimeConfig, AgentSession } from "./types";

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
