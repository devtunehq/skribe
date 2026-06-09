import { RotateCcw, Send, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, type Dispatch } from "react";
import { AgentTypingIndicator } from "./AgentTypingIndicator";
import { stickToBottomIfNear } from "./useStickToBottomScroll";
import {
  toneArchetypeOptions,
  toneLinkSlots
} from "./settingsOptions";
import type { ToneSetupAction, ToneSetupState } from "./toneSetupState";

export function ToneSetupBody({
  toneState,
  isBusy,
  dispatchTone,
  onBuildTone,
  onRestartInterview,
  onSubmitInterviewMessage
}: {
  toneState: ToneSetupState;
  isBusy: boolean;
  dispatchTone: Dispatch<ToneSetupAction>;
  onBuildTone: () => Promise<string>;
  onRestartInterview: () => void;
  onSubmitInterviewMessage: () => Promise<void>;
}) {
  const {
    mode,
    manualText,
    interviewMessages,
    interviewDraft,
    interviewState,
    urls,
    selectedArchetypeId,
    generatedTone,
    warnings,
    builderState,
    errorMessage
  } = toneState;
  const interviewMessagesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    stickToBottomIfNear(interviewMessagesRef.current);
  }, [interviewMessages, interviewState, interviewDraft]);

  return (
    <div className="tone-setup-body">
      {mode === "manual" ? (
        <label className="settings-field">
          <span>Manual tone</span>
          <textarea
            value={manualText}
            onChange={(event) => dispatchTone({ type: "set-manual-text", value: event.target.value })}
            placeholder="Direct, founder-to-founder, plainspoken, no hype, British English."
            rows={8}
          />
        </label>
      ) : null}

      {mode === "interview" ? (
        <div className="tone-interview-chat">
          <div className="settings-field-header">
            <span>Interview</span>
            <button type="button" className="ghost-button small" onClick={onRestartInterview} disabled={isBusy}>
              <RotateCcw size={14} />
              Start over
            </button>
          </div>
          <div className="tone-interview-messages" ref={interviewMessagesRef} aria-live="polite">
            {interviewMessages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`tone-interview-message is-${message.role}`}>
                <strong>{message.role === "agent" ? "Skribe" : "You"}</strong>
                <p>{message.body}</p>
              </article>
            ))}
            {interviewState === "thinking" ? <AgentTypingIndicator label="Skribe is thinking" /> : null}
          </div>
          <form
            className="tone-interview-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmitInterviewMessage();
            }}
          >
            <textarea
              value={interviewDraft}
              aria-label="Tone interview reply"
              onChange={(event) => dispatchTone({ type: "set-interview-draft", value: event.target.value })}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void onSubmitInterviewMessage();
                }
              }}
              placeholder="Reply to Skribe..."
              rows={4}
              disabled={isBusy}
            />
            <button className="primary-button" type="submit" disabled={isBusy || !interviewDraft.trim()}>
              <Send size={15} />
              Send
            </button>
          </form>
        </div>
      ) : null}

      {mode === "links" ? (
        <div className="tone-link-list">
          {toneLinkSlots.map((slot) => (
            <label key={slot.id} className="settings-field">
              <span>{slot.label}</span>
              <input
                value={urls[slot.position] ?? ""}
                onChange={(event) => dispatchTone({ type: "set-url", position: slot.position, value: event.target.value })}
                placeholder="https://example.com/post"
              />
            </label>
          ))}
        </div>
      ) : null}

      {mode === "archetype" ? (
        <div className="tone-archetype-grid">
          {toneArchetypeOptions.map((archetype) => (
            <button
              key={archetype.id}
              className={selectedArchetypeId === archetype.id ? "is-selected" : ""}
              onClick={() => {
                dispatchTone({ type: "set-selected-archetype", archetypeId: archetype.id });
              }}
              type="button"
            >
              <strong>{archetype.label}</strong>
              <small>{archetype.description}</small>
            </button>
          ))}
        </div>
      ) : null}

      {mode !== "manual" ? (
        <div className="tone-preview">
          <div className="settings-field-header">
            <span>Generated tone</span>
            <button type="button" className="secondary-button small" onClick={onBuildTone} disabled={isBusy}>
              <Sparkles size={14} />
              {builderState === "generating" ? "Generating" : "Generate"}
            </button>
          </div>
          <textarea
            value={generatedTone}
            aria-label="Generated tone of voice"
            onChange={(event) => dispatchTone({ type: "set-generated-tone", value: event.target.value })}
            placeholder="Generate a tone profile, then edit it here."
            rows={6}
          />
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="tone-warning-list">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {errorMessage ? <p className="tone-error">{errorMessage}</p> : null}
    </div>
  );
}
