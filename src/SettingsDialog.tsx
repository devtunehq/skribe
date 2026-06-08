import { useState } from "react";
import { Save, X } from "lucide-react";
import { ModalDialogShell } from "./ModalDialogShell";
import { settingsTabOptions } from "./settingsOptions";
import { SettingsAgentPanel } from "./SettingsAgentPanel";
import { SettingsWorkspacePanel } from "./SettingsWorkspacePanel";
import { SettingsWritingPanel } from "./SettingsWritingPanel";
import type {
  AgentRuntimeConfig,
  AgentSkill,
  AppSettings
} from "./types";
import type { SettingsTab } from "./settingsOptions";

type SaveState = "loading" | "saved" | "saving" | "error";

export function SettingsDialog({
  settings,
  saveState,
  skills,
  runtimeOptions,
  resolvedRuntime,
  onChange,
  onOpenToneSetup,
  onSave,
  onCancel
}: {
  settings: AppSettings;
  saveState: SaveState;
  skills: AgentSkill[];
  runtimeOptions: AgentRuntimeConfig["runtimes"];
  resolvedRuntime: string | null;
  onChange: (patch: Partial<AppSettings>) => void;
  onOpenToneSetup: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("writing");

  return (
    <ModalDialogShell className="settings-backdrop" labelledBy="settings-title" onCancel={onCancel}>
      <section className="settings-dialog">
        <header className="settings-dialog-header">
          <div>
            <span>Settings</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button type="button" className="icon-button mini" onClick={onCancel} title="Close settings">
            <X size={15} />
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {settingsTabOptions.map((tab) => (
            <button
              key={tab.id}
              type="button"
              id={`settings-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id={`settings-panel-${activeTab}`}
          className="settings-form settings-tab-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
        >
          {activeTab === "writing" ? (
            <SettingsWritingPanel settings={settings} onChange={onChange} onOpenToneSetup={onOpenToneSetup} />
          ) : null}
          {activeTab === "agent" ? (
            <SettingsAgentPanel
              settings={settings}
              skills={skills}
              runtimeOptions={runtimeOptions}
              resolvedRuntime={resolvedRuntime}
              onChange={onChange}
            />
          ) : null}
          {activeTab === "workspace" ? <SettingsWorkspacePanel settings={settings} onChange={onChange} /> : null}
        </div>

        <footer className="settings-dialog-actions">
          <span className={`settings-save-state is-${saveState}`}>{saveState}</span>
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onSave} disabled={saveState === "saving"}>
            <Save size={15} />
            Save
          </button>
        </footer>
      </section>
    </ModalDialogShell>
  );
}
