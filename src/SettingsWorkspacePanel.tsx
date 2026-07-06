import { SettingsLabel } from "./SettingsLabel";
import type { AppSettings } from "./types";

export function SettingsWorkspacePanel({
  settings,
  onChange
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.showResolvedThreads}
          onChange={(event) => onChange({ showResolvedThreads: event.target.checked })}
        />
        <SettingsLabel tooltip="Controls whether resolved comment threads are visible by default.">
          Show resolved threads
        </SettingsLabel>
      </label>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.showStatusBar}
          onChange={(event) => onChange({ showStatusBar: event.target.checked })}
        />
        <SettingsLabel tooltip="Show the bottom status bar with agent runtime, word count, and context usage.">
          Show status bar
        </SettingsLabel>
      </label>

      <div className="settings-grid">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={settings.panelState.leftCollapsed}
            onChange={(event) =>
              onChange({
                panelState: {
                  ...settings.panelState,
                  leftCollapsed: event.target.checked
                }
              })
            }
          />
          <SettingsLabel tooltip="Start each document with the outline and revision sidebar collapsed.">
            Collapse left panel
          </SettingsLabel>
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={settings.panelState.rightCollapsed}
            onChange={(event) =>
              onChange({
                panelState: {
                  ...settings.panelState,
                  rightCollapsed: event.target.checked
                }
              })
            }
          />
          <SettingsLabel tooltip="Start each document with the threads and chat sidebar collapsed.">
            Collapse right panel
          </SettingsLabel>
        </label>
      </div>
    </>
  );
}
