# Plan: Agent Runtime And Model Selection

## Goal

Let Skribe use either Codex CLI or Claude Code behind the scenes, while keeping the rest of the app provider-agnostic. Users should be able to choose:

- Agent runtime: `auto`, `codex`, `claude`, and eventually others.
- Model: `auto/default`, a detected model/alias when the underlying CLI exposes one, or a manually entered model id.

The editor, comments, proposals, skills, and context packet should not care which CLI is used.

## Current State

- Runtime is selected once at server start with `SKRIBE_AGENT_RUNTIME`, defaulting to `codex`.
- `server/index.mjs` has `runAgentRuntime()`, `runCodexAgent()`, and `runStubAgent()`.
- The turn contract is already provider-neutral: Skribe builds one prompt, receives JSON-like agent output, then applies `chatReply`, `threadReplies`, `suggestions`, and `documentProposals`.
- `AgentSession.runtime` is shown in state, but there is no model field, runtime chooser, model chooser, or runtime capability endpoint.
- Local checks show:
  - `codex exec` supports `--model`, `--sandbox read-only`, `-C`, and `-o`.
  - `claude --print` supports `--model`, `--output-format`, `--json-schema`, `--permission-mode`, `--tools`, and `--bare`.
  - Neither CLI help output exposes a reliable complete model list.

## Design Principles

1. Keep Skribe core provider-agnostic.
   The app should talk to an `AgentRuntimeAdapter`, not to Codex or Claude directly.

2. Treat model discovery as best-effort.
   Auto-detect CLI availability, version, flags, current default model, and any discoverable aliases. Always support manual model entry because CLIs may not expose a full model list.

3. Persist runtime/model per document session.
   This belongs in `session.json`, not `review.json`, because it is execution configuration rather than editorial content.

4. Keep `auto` meaningful.
   `runtime=auto` should pick the first healthy configured runtime using a stable priority, defaulting to Codex for backward compatibility unless overridden.
   `model=auto` should omit the CLI model flag and let the chosen runtime use its own configured default.

5. Validate at the adapter boundary.
   Each adapter owns CLI args, output extraction, model flag handling, and capability detection.

## Backend Plan

### 1. Add Runtime Adapter Contract

Create a small adapter layer, either in `server/index.mjs` first or split into `server/agent-runtimes/*.mjs` once stable.

Adapter shape:

```js
{
  id: "codex",
  label: "Codex CLI",
  command: "codex",
  detect: async () => ({
    available: true,
    version: "...",
    supportsModelFlag: true,
    supportsStructuredOutput: true,
    models: [],
    defaultModel: null,
    notes: []
  }),
  run: async ({ turn, prompt, outputSchemaPath, model, timeoutMs }) => output
}
```

Implement adapters:

- `stub`: existing local test runtime.
- `codex`: current behavior moved behind the adapter.
- `claude`: new Claude Code adapter.

### 2. Codex Adapter

Use the current invocation, with optional model support:

```bash
codex exec \
  --skip-git-repo-check \
  --sandbox read-only \
  -C "$docDir" \
  -o "$outputPath" \
  --model "$model" \
  -
```

Rules:

- If model is `auto` or empty, omit `--model`.
- Prefer `--output-schema` in a follow-up if the current Codex version handles it reliably for this prompt. Until then, keep the existing output-file parse path.
- Preserve `read-only` sandbox.

### 3. Claude Adapter

Use Claude Code in non-interactive print mode:

```bash
claude \
  --print \
  --output-format text \
  --permission-mode dontAsk \
  --tools "" \
  --model "$model" \
  "$prompt"
```

Initial recommendation:

- Start with `--tools ""` because Skribe already supplies all document context and expects JSON output, not file edits.
- Consider `--bare` only after checking that required skills still resolve the way we need. Claude help says skills still resolve in bare mode, but this needs practical validation.
- If model is `auto` or empty, omit `--model`.
- If `--output-format json` is used, adapter must extract the final text/result field before passing to `parseAgentOutput`.
- Use `--json-schema` later to tighten output, once both adapters share a schema.

### 4. Shared Output Schema

Add `server/agent-output.schema.json` with the current Skribe output shape:

- `reply`
- `chatReply`
- `threadReplies`
- `suggestions`
- `documentProposals`

Use it where possible:

- Codex: `--output-schema <file>` if stable.
- Claude: `--json-schema <schema>` if stable.

Keep `parseAgentOutput()` as the fallback because both CLIs may still emit text wrappers or diagnostic output.

### 5. Runtime Configuration State

Extend session state:

```ts
interface AgentSession {
  runtime: string;
  configuredRuntime: "auto" | string;
  model: string | null;
  configuredModel: "auto" | string;
  availableRuntimes?: AgentRuntimeStatus[];
  ...
}
```

Server-side default:

```js
agentConfig: {
  runtime: process.env.SKRIBE_AGENT_RUNTIME || "auto",
  model: process.env.SKRIBE_AGENT_MODEL || "auto"
}
```

Resolution:

- `configuredRuntime=auto` resolves to the first available runtime by priority.
- Priority can be env-configurable with `SKRIBE_AGENT_RUNTIME_PRIORITY=codex,claude,stub`.
- `configuredModel=auto` means no model flag.

### 6. Runtime And Model API

Add endpoints:

```http
GET /api/agent/runtimes
```

Returns:

```json
{
  "configuredRuntime": "auto",
  "resolvedRuntime": "codex",
  "configuredModel": "auto",
  "resolvedModel": null,
  "runtimes": [
    {
      "id": "codex",
      "label": "Codex CLI",
      "available": true,
      "version": "...",
      "models": [],
      "supportsManualModel": true,
      "defaultModel": null,
      "notes": ["No complete model list exposed by CLI; manual model id supported."]
    }
  ]
}
```

```http
PUT /api/agent/config
```

Body:

```json
{
  "runtime": "claude",
  "model": "sonnet"
}
```

Behavior:

- Validate runtime exists or is `auto`.
- Validate model is `auto`, one of detected models, or a non-empty manual string.
- Persist to the current document session.
- Broadcast updated document state.
- Do not switch runtime mid-run; if agent status is `running`, return `409` or queue the config change for after the active turn. Prefer `409` first.

### 7. Model Discovery

Discovery should be adapter-owned and layered:

1. Detect executable with `command -v`.
2. Capture `--version` and `--help`.
3. Parse whether `--model` is supported.
4. Read local CLI config for default model when safely available:
   - Codex: `$CODEX_HOME/config.toml` or `~/.codex/config.toml`.
   - Claude: user/project settings only if the CLI exposes safe config inspection; otherwise skip.
5. Parse CLI help for known aliases only when present in help text.
   - Claude help currently mentions aliases like `sonnet` and `opus`.
   - Codex help confirms `--model` but does not list models.
6. Return an empty model list plus `supportsManualModel=true` when no reliable list exists.

Do not hardcode a global model catalog into Skribe core. If adapters want provider-specific aliases, keep them inside the adapter and mark them as `source: "help" | "config" | "manual"`.

## Frontend Plan

### 1. Types And API

Add:

- `AgentRuntimeStatus`
- `AgentRuntimeConfig`
- `fetchAgentRuntimes()`
- `updateAgentConfig(config)`

Extend `AgentSession` with model/config fields.

### 2. Header Controls

Replace the current runtime/status pill area with:

- Status pill: idle/running/error.
- Runtime selector: Auto, Codex, Claude, Stub if available.
- Model selector/input:
  - Auto/default option first.
  - Detected models/aliases if available.
  - Manual entry option for arbitrary model id.

Visual rule:

- Keep it compact in the top bar.
- Show runtime health in tooltips or a small details popover, not as noisy inline text.

### 3. Behavior

- Disable runtime/model controls while an agent turn is running.
- On runtime change, refetch model capabilities for the selected runtime.
- On model change, persist immediately.
- Show clear errors:
  - "Claude CLI not found"
  - "Codex CLI not found"
  - "Selected runtime does not support model selection"
  - "Cannot change runtime while agent is running"

## Migration Plan

1. Existing `session.json` without config should load as:
   - `configuredRuntime = SKRIBE_AGENT_RUNTIME || "codex"` for backward compatibility.
   - `configuredModel = SKRIBE_AGENT_MODEL || "auto"`.
2. New sessions should default to:
   - `configuredRuntime = "auto"`.
   - `configuredModel = "auto"`.
3. Keep `SKRIBE_AGENT_RUNTIME` and `SKRIBE_AGENT_MODEL` as startup defaults/overrides.

## Testing Plan

### Backend

- Adapter detection tests:
  - Codex available/unavailable.
  - Claude available/unavailable.
  - Help text with and without `--model`.
- Config API tests:
  - Set runtime to `auto`, `codex`, `claude`.
  - Reject unknown runtime.
  - Reject runtime switch while running.
  - Accept manual model ids.
- Adapter invocation tests:
  - `model=auto` omits model flag.
  - `model=sonnet` passes Claude `--model sonnet`.
  - `model=gpt-5` passes Codex `--model gpt-5`.
- Output parsing tests for:
  - Plain JSON.
  - Fenced JSON.
  - Claude JSON envelope if `--output-format json` is adopted.

### Frontend

- Runtime/model controls render current session config.
- Runtime unavailable state is visible but not selectable.
- Model manual entry persists.
- Controls disable during running turns.
- Agent status pill still updates over SSE.

### Manual Smoke Tests

1. `SKRIBE_AGENT_RUNTIME=codex npm run dev`
2. `SKRIBE_AGENT_RUNTIME=claude npm run dev`
3. Select Codex + auto model, send chat turn.
4. Select Claude + `sonnet`, send chat turn.
5. Ask for a document proposal under both runtimes and confirm diffs appear in the editor.
6. Confirm selected skills are still visible in the prompt and usable by the chosen runtime.

## Rollout Order

1. Add adapter contract and move Codex/stub into it.
2. Add Claude adapter with conservative non-interactive invocation.
3. Add runtime/model config to session state.
4. Add `/api/agent/runtimes` and `/api/agent/config`.
5. Add frontend selectors.
6. Add shared output schema support.
7. Add tests and smoke scripts.

## Open Questions

- Should runtime/model config be per document, global, or both? Recommendation: per document first, with env vars as startup defaults.
- Should Claude run with `--bare`? Recommendation: test after basic adapter works, because skill behavior matters here.
- Should Skribe ever allow CLI tools/file access? Recommendation: no for now. The app wants proposals, not direct file edits.
- Should model discovery spend tokens to validate models? Recommendation: no by default. Only run a paid smoke test when the user explicitly selects a model and sends a turn.
