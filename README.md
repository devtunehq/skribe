# Skribe

Skribe is a local-only Markdown review workbench for writing with an AI partner.

It stores clean document content separately from review state:

- `data/docs/default/draft.md` is the local Markdown source.
- `data/docs/default/review.json` contains title, anchored threads, suggestions, chat, proposals, and context memory.
- `data/docs/default/session.json` tracks the local agent session state.
- External Markdown files opened with `skribe path/to/doc.md` keep the `.md` file as the content source and store Skribe review state under `data/external/<doc-id>/`.

Run it locally:

```bash
npm install
npm run build
npm run serve
```

Open `http://127.0.0.1:4327`.

To open a specific Markdown file:

```bash
npm run serve -- path/to/mydoc.md
```

Or link the local CLI and use:

```bash
npm link
skribe path/to/mydoc.md
```

For development, run the API server and Vite separately:

```bash
npm run serve
npm run dev
```

Agent runtime defaults can be set at startup, then changed in the app header:

```bash
SKRIBE_AGENT_RUNTIME=auto SKRIBE_AGENT_MODEL=auto npm run serve
SKRIBE_AGENT_RUNTIME=claude SKRIBE_AGENT_MODEL=sonnet npm run serve
SKRIBE_AGENT_RUNTIME=codex SKRIBE_AGENT_MODEL=gpt-5 npm run serve
```

Supported runtime values are `auto`, `codex`, `claude`, and `stub`. `auto` picks the first healthy local CLI from `SKRIBE_AGENT_RUNTIME_PRIORITY`, defaulting to `codex,claude`. `SKRIBE_AGENT_MODEL=auto` leaves model choice to the selected CLI.

The app keeps one active document in memory for snappy editing. It checkpoints Markdown back to the active `.md` file and checkpoints review state to the active document's Skribe sidecar directory. Local document data is ignored by git.
