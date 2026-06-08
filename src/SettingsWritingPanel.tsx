import { Sparkles } from "lucide-react";
import {
  appThemeOptions,
  documentFontOptions,
  editorLanguageOptions
} from "./settingsOptions";
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
          <span>Tone of voice</span>
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

      <div className="settings-grid">
        <label className="settings-field">
          <span>Language</span>
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
          <span>Document font</span>
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
        <span>Theme</span>
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
