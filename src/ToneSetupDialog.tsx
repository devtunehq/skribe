import { useCallback, useEffect, useReducer } from "react";
import {
  BookOpen,
  Globe,
  MessageSquare,
  PenLine,
  Save,
  X
} from "lucide-react";
import {
  generateToneOfVoice,
  sendToneInterviewMessage
} from "./api";
import { ModalDialogShell } from "./ModalDialogShell";
import {
  toneArchetypeOptions,
  toneSetupModes
} from "./settingsOptions";
import { ToneSetupBody } from "./ToneSetupBody";
import {
  createToneSetupState,
  toneSetupReducer
} from "./toneSetupState";
import type {
  EditorLanguage,
  ToneInterviewMessage,
  ToneSetupMode
} from "./types";

export type ToneSetupInvocation = "first-run" | "settings";

function toneModeIcon(mode: ToneSetupMode) {
  if (mode === "manual") return <PenLine size={15} />;
  if (mode === "interview") return <MessageSquare size={15} />;
  if (mode === "links") return <Globe size={15} />;
  return <BookOpen size={15} />;
}

export function ToneSetupDialog({
  invocation,
  currentTone,
  editorLanguage,
  onSave,
  onSkip,
  onCancel
}: {
  invocation: ToneSetupInvocation;
  currentTone: string;
  editorLanguage: EditorLanguage;
  onSave: (toneOfVoice: string) => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const defaultToneArchetypeId = toneArchetypeOptions[0]?.id ?? "direct-founder";
  const [toneState, dispatchTone] = useReducer(toneSetupReducer, currentTone, (tone) =>
    createToneSetupState(tone, defaultToneArchetypeId)
  );
  const {
    mode,
    manualText,
    interviewMessages,
    interviewDraft,
    urls,
    selectedArchetypeId,
    generatedTone,
    builderState,
    interviewState
  } = toneState;
  const previewTone = mode === "manual" ? manualText : generatedTone;
  const isBusy = builderState === "generating" || builderState === "saving" || interviewState === "thinking";
  const allowFirstRunDismiss = invocation === "first-run";

  const requestInterviewTurn = useCallback(async (nextMessages: ToneInterviewMessage[], options: { forceGenerate?: boolean } = {}) => {
    dispatchTone({ type: "interview-request-start" });
    try {
      const response = await sendToneInterviewMessage({
        messages: nextMessages,
        editorLanguage,
        currentTone: generatedTone || currentTone,
        forceGenerate: options.forceGenerate
      });
      const reply = response.reply.trim();
      const messagesWithReply = reply ? [...nextMessages, { role: "agent" as const, body: reply }] : nextMessages;
      dispatchTone({
        type: "interview-request-success",
        messages: messagesWithReply,
        toneOfVoice: response.toneOfVoice || undefined,
        warnings: response.warnings
      });
      return response;
    } catch (error) {
      dispatchTone({
        type: "interview-request-error",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }, [currentTone, editorLanguage, generatedTone]);

  useEffect(() => {
    if (mode !== "interview" || interviewMessages.length > 0 || interviewState === "thinking") return;
    void requestInterviewTurn([]);
  }, [interviewMessages.length, interviewState, mode, requestInterviewTurn]);

  async function submitInterviewMessage() {
    const body = interviewDraft.trim();
    if (!body || isBusy) return;
    const nextMessages: ToneInterviewMessage[] = [...interviewMessages, { role: "human", body }];
    dispatchTone({ type: "set-interview-messages", messages: nextMessages });
    dispatchTone({ type: "set-interview-draft", value: "" });
    await requestInterviewTurn(nextMessages);
  }

  function restartInterview() {
    dispatchTone({ type: "restart-interview" });
    void requestInterviewTurn([]);
  }

  async function buildTone() {
    if (mode === "interview") {
      if (generatedTone.trim()) return generatedTone;
      dispatchTone({ type: "tone-generation-start" });
      const response = await requestInterviewTurn(interviewMessages, { forceGenerate: true });
      dispatchTone({ type: "set-builder-state", builderState: response ? "idle" : "error" });
      return response?.toneOfVoice ?? "";
    }

    dispatchTone({ type: "tone-generation-start" });
    try {
      const response = await generateToneOfVoice({
        mode,
        manualText,
        urls,
        archetypeId: selectedArchetypeId,
        editorLanguage
      });
      dispatchTone({
        type: "tone-generation-success",
        toneOfVoice: response.toneOfVoice,
        warnings: response.warnings,
        syncManualText: mode === "manual"
      });
      return response.toneOfVoice;
    } catch (error) {
      dispatchTone({
        type: "tone-generation-error",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return "";
    }
  }

  async function saveTone() {
    const tone = previewTone.trim() || (await buildTone()).trim();
    if (!tone) return;
    dispatchTone({ type: "tone-saving-start" });
    await onSave(tone);
  }

  return (
    <ModalDialogShell
      className="settings-backdrop tone-setup-backdrop"
      labelledBy="tone-setup-title"
      preventCancel={isBusy && !allowFirstRunDismiss}
      onCancel={onCancel}
    >
      <section className="settings-dialog tone-setup-dialog">
        <header className="settings-dialog-header">
          <div>
            <span>{invocation === "first-run" ? "First run" : "Settings"}</span>
            <h2 id="tone-setup-title">Tone of voice</h2>
          </div>
          <button
            type="button"
            className="icon-button mini"
            onClick={onCancel}
            title="Close tone setup"
            disabled={isBusy && !allowFirstRunDismiss}
          >
            <X size={15} />
          </button>
        </header>

        <div className="tone-mode-tabs" role="tablist" aria-label="Tone setup mode">
          {toneSetupModes.map((option) => (
            <button
              key={option.id}
              className={mode === option.id ? "is-active" : ""}
              onClick={() => {
                dispatchTone({ type: "set-mode", mode: option.id });
              }}
              type="button"
            >
              {toneModeIcon(option.id)}
              {option.label}
            </button>
          ))}
        </div>

        <ToneSetupBody
          toneState={toneState}
          isBusy={isBusy}
          dispatchTone={dispatchTone}
          onBuildTone={buildTone}
          onRestartInterview={restartInterview}
          onSubmitInterviewMessage={submitInterviewMessage}
        />

        <footer className="settings-dialog-actions">
          <span className={`settings-save-state is-${builderState === "error" ? "error" : "saved"}`}>
            {builderState === "generating" || builderState === "saving"
              ? "working"
              : builderState === "error"
                ? "error"
                : "ready"}
          </span>
          {invocation === "first-run" ? (
            <button type="button" className="ghost-button" onClick={onSkip}>
              Skip
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={onCancel} disabled={isBusy && !allowFirstRunDismiss}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={saveTone} disabled={isBusy}>
            <Save size={15} />
            Save tone
          </button>
        </footer>
      </section>
    </ModalDialogShell>
  );
}
