import { diffViewModeOptions } from "./settingsOptions";
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
          <span>Agent provider</span>
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
        </label>

        <label className="settings-field">
          <span>Agent model</span>
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
        <span>Agent effort</span>
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
        <span>Default skills</span>
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
        <span>Auto-reply to new comments</span>
      </label>

      <label className="settings-field">
        <span>Proposal mode</span>
        <select
          value={settings.proposalModeDefault}
          onChange={(event) => onChange({ proposalModeDefault: event.target.value === "bold" ? "bold" : "conservative" })}
        >
          <option value="conservative">Conservative</option>
          <option value="bold">Bold</option>
        </select>
      </label>

      <label className="settings-field">
        <span>Diff view</span>
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
    </>
  );
}
