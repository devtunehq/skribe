# Skribe

Skribe is a local-only Markdown review workbench for writing with an AI partner.

It stores clean document content separately from review state:

- `data/docs/default/draft.md` is the local Markdown source.
- `data/docs/default/review.json` contains title, anchored threads, suggestions, chat, proposals, and context memory.
- `data/docs/default/session.json` tracks the local agent session state.

Run it locally:

```bash
npm install
npm run build
npm run serve
```

Open `http://127.0.0.1:4327`.

For development, run the API server and Vite separately:

```bash
npm run serve
npm run dev
```

The app keeps the active document in memory for snappy editing and checkpoints to `data/docs/default/`. Local document data is ignored by git.
