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
        <span>Show resolved threads</span>
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
          <span>Collapse left panel</span>
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
          <span>Collapse right panel</span>
        </label>
      </div>
    </>
  );
}
