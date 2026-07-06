// Per-turn token usage extraction for each agent runtime. Kept as pure functions
// so the CLI output formats (which drift over time) can be regression-tested
// without spawning the real binaries.

// Normalizes per-turn token usage into a single shape the UI can render for any
// runtime. Returns null when no usage was reported (e.g. stub runtime, or a local
// server that omits the usage block). `inputTokens` is the total prompt size the
// caller already summed per the runtime's accounting (Claude splits cache buckets
// out of input_tokens; Codex/local fold them in).
export function buildTurnUsage({ runtime, inputTokens, outputTokens, contextWindow, costUsd }) {
  const input = Math.max(0, Math.round(Number(inputTokens) || 0));
  const output = Math.max(0, Math.round(Number(outputTokens) || 0));
  if (input <= 0 && output <= 0) return null;
  const window = Number(contextWindow) > 0 ? Number(contextWindow) : null;
  const cost = costUsd == null || !Number.isFinite(Number(costUsd)) ? null : Number(costUsd);
  return { runtime, inputTokens: input, outputTokens: output, contextWindow: window, costUsd: cost };
}

// Unwraps Claude Code's `--output-format json` result envelope: the model's reply
// text is in `.result`, and `.usage` / `.modelUsage[*].contextWindow` carry the
// real token accounting. Claude reports `input_tokens` as the NON-cached prompt
// portion, so total input sums the fresh + cache-creation + cache-read buckets.
export function parseClaudeResultEnvelope(stdout, { contextWindow } = {}) {
  let envelope = null;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    // Not JSON (older CLI or an error surfaced as text); fall back to raw stdout.
    return { replyText: stdout, usage: null };
  }
  if (!envelope || typeof envelope !== "object" || typeof envelope.result !== "string") {
    return { replyText: stdout, usage: null };
  }

  const usage = envelope.usage || {};
  const inputTokens =
    (Number(usage.input_tokens) || 0) +
    (Number(usage.cache_creation_input_tokens) || 0) +
    (Number(usage.cache_read_input_tokens) || 0);
  const modelWindow = Object.values(envelope.modelUsage || {})[0]?.contextWindow ?? null;

  return {
    replyText: envelope.result,
    usage: buildTurnUsage({
      runtime: "claude",
      inputTokens,
      outputTokens: usage.output_tokens,
      contextWindow: modelWindow ?? contextWindow,
      costUsd: envelope.total_cost_usd
    })
  };
}

// Scans Codex's JSONL event stream (stdout under `--json`) for the final
// `turn.completed` usage event. Codex reports `input_tokens` as the full prompt
// size (cached tokens are a subset), so we do not add `cached_input_tokens`.
export function parseCodexUsageFromStream(stdout, { contextWindow } = {}) {
  let usage = null;
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes("usage")) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.usage && (event.type === "turn.completed" || event.type === "turn_completed")) {
        usage = event.usage;
      }
    } catch {
      // Ignore non-JSON or partial lines; usage is best-effort.
    }
  }
  if (!usage) return null;
  return buildTurnUsage({
    runtime: "codex",
    inputTokens: usage.input_tokens,
    outputTokens: (Number(usage.output_tokens) || 0) + (Number(usage.reasoning_output_tokens) || 0),
    contextWindow,
    costUsd: null
  });
}
