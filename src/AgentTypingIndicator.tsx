export function AgentTypingIndicator({ label }: { label: string }) {
  return (
    <article className="message-bubble is-agent is-typing">
      <div>
        <strong>Agent</strong>
        <span>{label}</span>
      </div>
      <p aria-live="polite">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </p>
    </article>
  );
}
