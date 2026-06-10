import { diffViewModeOptions } from "./settingsOptions";
import { SettingsLabel } from "./SettingsLabel";
import { SettingsSkillPicker } from "./SettingsSkillPicker";
import type {
  AgentRuntimeConfig,
  AgentSkill,
  AppSettings,
  DiffViewMode
} from "./types";

export function SettingsAgentPanel({
  settings,
  skills,
  runtimeOptions,
  resolvedRuntime,
  onChange
}: {
  settings: AppSettings;
  skills: AgentSkill[];
  runtimeOptions: AgentRuntimeConfig["runtimes"];
  resolvedRuntime: string | null;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const selectedRuntimeId = settings.agentRuntime === "auto" ? resolvedRuntime : settings.agentRuntime;
  const selectedRuntimeStatus = runtimeOptions.find((runtime) => runtime.id === selectedRuntimeId) ?? null;
  const modelOptions = selectedRuntimeStatus?.models ?? [];
  const effortOptions = selectedRuntimeStatus?.effortLevels ?? [];
  const modelSelectValue =
    settings.agentModel === "auto" || modelOptions.some((model) => model.id === settings.agentModel)
      ? settings.agentModel
      : "__custom";
  const effortSelectValue =
    settings.agentEffort === "auto" || effortOptions.some((effort) => effort.id === settings.agentEffort)
      ? settings.agentEffort
      : "auto";
  const selectedDiffViewMode = diffViewModeOptions.find((option) => option.value === settings.diffViewMode) ?? diffViewModeOptions[0];

  return (
    <>
      <div className="settings-grid">
        <label className="settings-field">
          <SettingsLabel tooltip="Default agent runtime Skribe should use for agent turns: cloud CLI or local inference.">
            Agent provider
          </SettingsLabel>
          <select
            value={settings.agentRuntime}
            onChange={(event) =>
              onChange({
                agentRuntime: event.target.value,
                agentModel: "auto",
                agentEffort: "auto"
              })
            }
          >
            <option value="auto">Auto</option>
            {runtimeOptions.map((runtime) => (
              <option key={runtime.id} value={runtime.id} disabled={!runtime.available}>
                {runtime.label}
                {runtime.available ? "" : " unavailable"}
              </option>
            ))}
          </select>
          {selectedRuntimeStatus?.notes?.length ? <small>{selectedRuntimeStatus.notes.join(" ")}</small> : null}
        </label>

        <label className="settings-field">
          <SettingsLabel tooltip="Default model for the selected runtime when model selection is supported.">
            Agent model
          </SettingsLabel>
          <select
            value={modelSelectValue}
            disabled={Boolean(selectedRuntimeStatus && !selectedRuntimeStatus.supportsManualModel)}
            onChange={(event) => {
              if (event.target.value === "__custom") return;
              onChange({ agentModel: event.target.value });
            }}
          >
            <option value="auto">Default model</option>
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
            {modelSelectValue === "__custom" ? <option value="__custom">{settings.agentModel}</option> : null}
          </select>
        </label>
      </div>

      <label className="settings-field">
        <SettingsLabel tooltip="Default reasoning effort where the selected CLI supports it.">
          Agent effort
        </SettingsLabel>
        <select
          value={effortSelectValue}
          disabled={Boolean(selectedRuntimeStatus && !selectedRuntimeStatus.supportsEffort)}
          onChange={(event) => onChange({ agentEffort: event.target.value })}
        >
          <option value="auto">Default effort</option>
          {effortOptions.map((effort) => (
            <option key={effort.id} value={effort.id}>
              {effort.label}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-field">
        <SettingsLabel tooltip="Favourite skills preselected for new chat messages and new comment threads.">
          Default skills
        </SettingsLabel>
        <SettingsSkillPicker
          skills={skills}
          selectedSkillIds={settings.defaultSkills}
          onChange={(defaultSkills) => onChange({ defaultSkills })}
        />
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.autoReplyToComments}
          onChange={(event) => onChange({ autoReplyToComments: event.target.checked })}
        />
        <SettingsLabel tooltip="When enabled, a new anchored comment immediately asks the agent for a reply.">
          Auto-reply to new comments
        </SettingsLabel>
      </label>

      <label className="settings-field">
        <SettingsLabel tooltip="Controls whether broad rewrites should ask first or produce reviewable diffs when requested.">
          Proposal mode
        </SettingsLabel>
        <select
          value={settings.proposalModeDefault}
          onChange={(event) => onChange({ proposalModeDefault: event.target.value === "bold" ? "bold" : "conservative" })}
        >
          <option value="conservative">Conservative</option>
          <option value="bold">Bold</option>
        </select>
      </label>

      <label className="settings-field">
        <SettingsLabel tooltip="Choose split view for side-by-side blocks or unified view for compact minus/plus lines.">
          Diff view
        </SettingsLabel>
        <select
          value={settings.diffViewMode}
          onChange={(event) => onChange({ diffViewMode: event.target.value as DiffViewMode })}
        >
          {diffViewModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small>{selectedDiffViewMode.description}</small>
      </label>

      <div className="settings-subsection">
        <h3 className="settings-subsection-title">Local inference</h3>
        <p className="settings-subsection-copy">
          These apply when Agent provider is Local (or Auto resolves to Local). Environment variables still override them
          if set.
        </p>

        <label className="settings-field">
          <SettingsLabel tooltip="OpenAI-compatible base URL, e.g. http://127.0.0.1:11434/v1 for Ollama. Leave blank to auto-detect Ollama, LM Studio, and llama.cpp.">
            Base URL
          </SettingsLabel>
          <input
            type="url"
            value={settings.localInferenceBaseUrl}
            placeholder="http://127.0.0.1:11434/v1"
            onChange={(event) => onChange({ localInferenceBaseUrl: event.target.value })}
          />
        </label>

        <div className="settings-grid">
          <label className="settings-field">
            <SettingsLabel tooltip="Optional bearer token for local servers that require auth.">
              API key
            </SettingsLabel>
            <input
              type="password"
              value={settings.localInferenceApiKey}
              autoComplete="off"
              placeholder="Optional"
              onChange={(event) => onChange({ localInferenceApiKey: event.target.value })}
            />
          </label>

          <label className="settings-field">
            <SettingsLabel tooltip="Maximum output tokens per agent turn. This is not the model context window. If replies fail or truncate, also raise your inference server context (for Ollama: OLLAMA_NUM_CTX=32768) and use fewer skills.">
              Max completion tokens
            </SettingsLabel>
            <input
              type="number"
              min={512}
              max={32768}
              step={256}
              value={settings.localInferenceMaxTokens}
              onChange={(event) =>
                onChange({
                  localInferenceMaxTokens: Number(event.target.value) || 4096
                })
              }
            />
          </label>
        </div>
      </div>
    </>
  );
}
