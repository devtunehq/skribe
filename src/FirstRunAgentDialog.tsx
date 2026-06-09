import { ArrowRight, Sparkles, X } from "lucide-react";
import { ModalDialogShell } from "./ModalDialogShell";
import { SettingsLabel } from "./SettingsLabel";
import type { AgentRuntimeConfig, AppSettings } from "./types";

export function FirstRunAgentDialog({
  settings,
  runtimeOptions,
  resolvedRuntime,
  onChange,
  onContinue,
  onSkip
}: {
  settings: AppSettings;
  runtimeOptions: AgentRuntimeConfig["runtimes"];
  resolvedRuntime: string | null;
  onChange: (patch: Partial<AppSettings>) => void;
  onContinue: () => void | Promise<void>;
  onSkip: () => void;
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

  return (
    <ModalDialogShell
      className="settings-backdrop first-run-agent-backdrop"
      labelledBy="first-run-agent-title"
      onCancel={onSkip}
    >
      <section className="settings-dialog first-run-agent-dialog">
        <header className="settings-dialog-header">
          <div>
            <span>First run</span>
            <h2 id="first-run-agent-title">Choose your agent</h2>
          </div>
          <button type="button" className="icon-button mini" onClick={onSkip} title="Skip agent setup">
            <X size={15} />
          </button>
        </header>

        <p className="first-run-agent-intro">
          Pick the local CLI and model Skribe should use for chat, comments, and tone setup. You can change this later
          from the header or Settings.
        </p>

        <div className="settings-grid">
          <label className="settings-field">
            <SettingsLabel tooltip="Default local CLI runtime Skribe should use for agent turns.">
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
          </label>

          <label className="settings-field">
            <SettingsLabel tooltip="Default model for the selected CLI when the runtime exposes model selection.">
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

        <footer className="settings-dialog-actions">
          <button type="button" className="ghost-button" onClick={onSkip}>
            Skip
          </button>
          <button type="button" className="primary-button" onClick={() => void onContinue()}>
            <Sparkles size={15} />
            Continue
            <ArrowRight size={15} />
          </button>
        </footer>
      </section>
    </ModalDialogShell>
  );
}
