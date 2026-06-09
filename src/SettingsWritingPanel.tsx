import { Sparkles } from "lucide-react";
import {
  appThemeOptions,
  documentFontOptions,
  editorLanguageOptions
} from "./settingsOptions";
import { SettingsLabel } from "./SettingsLabel";
import type {
  AppSettings,
  AppTheme,
  DocumentFont,
  EditorLanguage
} from "./types";

export function SettingsWritingPanel({
  settings,
  onChange,
  onOpenToneSetup
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onOpenToneSetup: () => void;
}) {
  const selectedDocumentFont = documentFontOptions.find((option) => option.value === settings.documentFont) ?? documentFontOptions[0];
  const selectedTheme = appThemeOptions.find((option) => option.value === settings.theme) ?? appThemeOptions[0];

  return (
    <>
      <div className="settings-field">
        <div className="settings-field-header">
          <SettingsLabel tooltip="A persistent writing preference the agent should follow when replying or proposing edits.">
            Tone of voice
          </SettingsLabel>
          <button type="button" className="secondary-button small" onClick={onOpenToneSetup}>
            <Sparkles size={14} />
            Build tone
          </button>
        </div>
        <textarea
          value={settings.toneOfVoice}
          aria-label="Tone of voice"
          onChange={(event) => onChange({ toneOfVoice: event.target.value })}
          placeholder="Direct, plainspoken, founder-to-founder, no hype."
          rows={5}
        />
      </div>

      <label className="settings-field">
        <SettingsLabel tooltip="Used to label your messages in chat and comment threads. Leave blank to show You.">
          Your name
        </SettingsLabel>
        <input
          type="text"
          value={settings.userName}
          aria-label="Your name"
          onChange={(event) => onChange({ userName: event.target.value })}
          placeholder="You"
          maxLength={120}
        />
        <small>Shown in conversation labels only. Stored locally with your settings.</small>
      </label>

      <div className="settings-grid">
        <label className="settings-field">
          <SettingsLabel tooltip="Default spelling convention for the editor and agent guidance.">
            Language
          </SettingsLabel>
          <select
            value={settings.editorLanguage}
            onChange={(event) => onChange({ editorLanguage: event.target.value as EditorLanguage })}
          >
            {editorLanguageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small className="is-placeholder" aria-hidden="true">
            Language helper
          </small>
        </label>

        <label className="settings-field">
          <SettingsLabel tooltip="Controls the rendered document font in the editable canvas.">
            Document font
          </SettingsLabel>
          <select
            value={settings.documentFont}
            onChange={(event) => onChange({ documentFont: event.target.value as DocumentFont })}
          >
            {documentFontOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>{selectedDocumentFont.description}</small>
        </label>
      </div>

      <label className="settings-field">
        <SettingsLabel tooltip="Changes the app colour palette.">
          Theme
        </SettingsLabel>
        <select value={settings.theme} onChange={(event) => onChange({ theme: event.target.value as AppTheme })}>
          {appThemeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small>{selectedTheme.description}</small>
      </label>
    </>
  );
}
