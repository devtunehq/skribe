import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTurnUsage,
  extractCodexMessageText,
  parseClaudeResultEnvelope,
  parseCodexUsageFromStream
} from "../server/agent-usage.mjs";

test("buildTurnUsage returns null when no tokens were reported", () => {
  assert.equal(buildTurnUsage({ runtime: "claude", inputTokens: 0, outputTokens: 0 }), null);
  assert.equal(buildTurnUsage({ runtime: "local" }), null);
});

test("buildTurnUsage normalizes tokens, window, and cost", () => {
  assert.deepEqual(
    buildTurnUsage({ runtime: "codex", inputTokens: 22443.4, outputTokens: 27, contextWindow: 272000, costUsd: null }),
    { runtime: "codex", inputTokens: 22443, outputTokens: 27, contextWindow: 272000, costUsd: null }
  );
  // A non-positive window collapses to null rather than a bogus percentage base.
  assert.equal(buildTurnUsage({ runtime: "local", inputTokens: 10, contextWindow: 0 }).contextWindow, null);
});

test("buildTurnUsage treats non-finite cost as null", () => {
  assert.equal(buildTurnUsage({ runtime: "claude", inputTokens: 10, costUsd: Number.NaN }).costUsd, null);
  assert.equal(buildTurnUsage({ runtime: "claude", inputTokens: 10, costUsd: "abc" }).costUsd, null);
  assert.equal(buildTurnUsage({ runtime: "claude", inputTokens: 10, costUsd: 0 }).costUsd, 0);
});

test("extractCodexMessageText recovers the agent message from the JSONL stream", () => {
  const stdout = [
    '{"type":"thread.started"}',
    '{"type":"item.completed","item":{"type":"error","message":"ignored"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"chatReply\\":\\"hi\\"}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}'
  ].join("\n");
  assert.equal(extractCodexMessageText(stdout), '{"chatReply":"hi"}');
});

test("extractCodexMessageText throws when no agent message is present", () => {
  assert.throws(() => extractCodexMessageText('{"type":"turn.completed","usage":{}}'), /no agent message/i);
  assert.throws(() => extractCodexMessageText(""), /no agent message/i);
});

test("parseClaudeResultEnvelope unwraps the reply and sums cache buckets into input", () => {
  // Shape captured from a real `claude --print --output-format json` run.
  const stdout = JSON.stringify({
    type: "result",
    result: '{"chatReply":"ok"}',
    total_cost_usd: 0.0226,
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 10316,
      cache_read_input_tokens: 17121,
      output_tokens: 48
    },
    modelUsage: { "claude-haiku-4-5-20251001": { contextWindow: 200000 } }
  });

  const { replyText, usage } = parseClaudeResultEnvelope(stdout, { contextWindow: null });
  assert.equal(replyText, '{"chatReply":"ok"}');
  assert.deepEqual(usage, {
    runtime: "claude",
    inputTokens: 10 + 10316 + 17121,
    outputTokens: 48,
    contextWindow: 200000,
    costUsd: 0.0226
  });
});

test("parseClaudeResultEnvelope falls back to raw text when stdout is not the JSON envelope", () => {
  const { replyText, usage } = parseClaudeResultEnvelope('{"chatReply":"legacy text mode"}', {});
  assert.equal(replyText, '{"chatReply":"legacy text mode"}');
  assert.equal(usage, null);
});

test("parseCodexUsageFromStream reads the final turn.completed usage event", () => {
  // Shape captured from a real `codex exec --json` run; input_tokens already
  // includes the cached subset, so cached tokens must not be double-counted.
  const stdout = [
    '{"type":"item.started","item":{"id":"0"}}',
    '{"type":"turn.completed","usage":{"input_tokens":22443,"cached_input_tokens":4992,"output_tokens":17,"reasoning_output_tokens":10}}',
    "not json"
  ].join("\n");

  const usage = parseCodexUsageFromStream(stdout, { contextWindow: 272000 });
  assert.deepEqual(usage, {
    runtime: "codex",
    inputTokens: 22443,
    outputTokens: 27,
    contextWindow: 272000,
    costUsd: null
  });
});

test("parseCodexUsageFromStream returns null when no usage event is present", () => {
  assert.equal(parseCodexUsageFromStream('{"type":"item.completed"}', {}), null);
  assert.equal(parseCodexUsageFromStream("", {}), null);
});
