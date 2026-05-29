import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const dataDir = join(root, "data");
const docsDir = join(dataDir, "docs");
const defaultDocId = "default";
const docDir = join(docsDir, defaultDocId);
const distDir = join(root, "dist");
const legacyDraftPath = join(dataDir, "draft.md");
const legacyReviewPath = join(dataDir, "review.json");
const draftPath = join(docDir, "draft.md");
const reviewPath = join(docDir, "review.json");
const sessionPath = join(docDir, "session.json");
const eventsPath = join(docDir, "events.jsonl");
const snapshotsDir = join(docDir, "snapshots");
const agentRuntimeName = process.env.SKRIBE_AGENT_RUNTIME || "codex";
const port = Number(process.env.PORT || 4327);

const defaultMarkdown = `# Untitled Draft

Start writing here, or import a Markdown file.

Highlight any sentence or paragraph in the canvas to start a thread. Suggestions and chat stay in local review state, while this Markdown file remains clean for export.
`;

const defaultReview = {
  version: 1,
  title: "Untitled Draft",
  threads: [],
  chat: [],
  proposals: [],
  contextLedger: [],
  updatedAt: new Date().toISOString()
};

const defaultSession = {
  id: defaultDocId,
  runtime: agentRuntimeName,
  status: "idle",
  turnCount: 0,
  queueDepth: 0,
  activeTurn: null,
  lastRunAt: null,
  lastError: null,
  updatedAt: new Date().toISOString()
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const subscribers = new Set();
const agentQueue = [];
const maxContextLedgerEvents = 240;
let checkpointTimer = null;
let documentMemory = null;
let agentRunning = false;

async function ensureDocumentFiles() {
  await mkdir(docDir, { recursive: true });
  await mkdir(snapshotsDir, { recursive: true });

  if (!existsSync(draftPath)) {
    const markdown = existsSync(legacyDraftPath) ? await readFile(legacyDraftPath, "utf8") : defaultMarkdown;
    await writeFile(draftPath, markdown, "utf8");
  }

  if (!existsSync(reviewPath)) {
    const review = existsSync(legacyReviewPath)
      ? await readJson(legacyReviewPath, defaultReview)
      : defaultReview;
    await writeFile(reviewPath, JSON.stringify(review, null, 2), "utf8");
  }

  if (!existsSync(sessionPath)) {
    await writeFile(sessionPath, JSON.stringify(defaultSession, null, 2), "utf8");
  }

  if (!existsSync(eventsPath)) {
    await writeFile(eventsPath, "", "utf8");
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { ...fallback };
  }
}

async function loadDocumentIntoMemory() {
  await ensureDocumentFiles();
  const [markdown, review, agentSession, draftStat, reviewStat] = await Promise.all([
    readFile(draftPath, "utf8"),
    readJson(reviewPath, defaultReview),
    readJson(sessionPath, defaultSession),
    stat(draftPath),
    stat(reviewPath)
  ]);

  documentMemory = {
    id: defaultDocId,
    markdown,
    review: normalizeReview(review),
    agentSession: {
      ...defaultSession,
      ...agentSession,
      runtime: agentRuntimeName,
      queueDepth: agentQueue.length
    },
    fileInfo: {
      draftPath,
      reviewPath,
      sessionPath,
      eventsPath,
      draftUpdatedAt: draftStat.mtime.toISOString(),
      reviewUpdatedAt: reviewStat.mtime.toISOString()
    }
  };

  return documentMemory;
}

function normalizeReview(review) {
  return {
    ...defaultReview,
    ...review,
    threads: Array.isArray(review?.threads) ? review.threads : [],
    chat: Array.isArray(review?.chat) ? review.chat : [],
    proposals: Array.isArray(review?.proposals) ? review.proposals : [],
    contextLedger: Array.isArray(review?.contextLedger) ? review.contextLedger : []
  };
}

function titleFromMarkdown(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Untitled Draft";
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clipText(text, maxLength = 360) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function makeLedgerEvent({ type, actor = "agent", summary, createdAt = nowIso(), threadId = null, proposalId = null, changeKey = null, metadata }) {
  return {
    id: makeId("mem"),
    type,
    actor,
    summary: clipText(summary),
    createdAt,
    threadId,
    proposalId,
    changeKey,
    metadata
  };
}

function appendLedgerEvents(events, nextEvents) {
  return [...(Array.isArray(events) ? events : []), ...nextEvents.filter(Boolean)].slice(-maxContextLedgerEvents);
}

function getDocument() {
  if (!documentMemory) throw new Error("Document is not loaded");
  return documentMemory;
}

function setDocument(next, reason = "document:update") {
  documentMemory = {
    ...next,
    review: normalizeReview(next.review),
    agentSession: {
      ...defaultSession,
      ...next.agentSession,
      runtime: agentRuntimeName,
      queueDepth: agentQueue.length,
      updatedAt: nowIso()
    }
  };
  scheduleCheckpoint();
  broadcast("document", documentMemory);
  appendEvent({ type: reason, at: nowIso() }).catch(() => undefined);
  return documentMemory;
}

function updateDocument(updater, reason) {
  return setDocument(updater(getDocument()), reason);
}

function scheduleCheckpoint() {
  if (checkpointTimer) clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => {
    checkpoint().catch((error) => console.error("checkpoint failed", error));
  }, 250);
}

async function checkpoint() {
  if (!documentMemory) return;
  const snapshot = documentMemory;
  await mkdir(docDir, { recursive: true });
  await Promise.all([
    atomicWrite(draftPath, snapshot.markdown),
    atomicWrite(reviewPath, JSON.stringify(snapshot.review, null, 2)),
    atomicWrite(sessionPath, JSON.stringify(snapshot.agentSession, null, 2))
  ]);
  const [draftStat, reviewStat] = await Promise.all([stat(draftPath), stat(reviewPath)]);
  documentMemory = {
    ...snapshot,
    fileInfo: {
      ...snapshot.fileInfo,
      draftUpdatedAt: draftStat.mtime.toISOString(),
      reviewUpdatedAt: reviewStat.mtime.toISOString()
    }
  };
}

async function atomicWrite(path, content) {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, path);
}

async function appendEvent(event) {
  await writeFile(eventsPath, `${JSON.stringify(event)}\n`, { flag: "a" });
}

function broadcast(type, payload) {
  const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    res.write(event);
  }
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store"
  });
  res.end(body);
}

function streamEvents(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write(`event: document\ndata: ${JSON.stringify(getDocument())}\n\n`);
  subscribers.add(res);
  req.on("close", () => subscribers.delete(res));
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/api/document") {
    sendJson(res, 200, getDocument());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    streamEvents(req, res);
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/document") {
    const body = await parseBody(req);
    const markdown = typeof body.markdown === "string" ? body.markdown : "";
    const review = body.review && typeof body.review === "object" ? body.review : defaultReview;
    const updatedAt = nowIso();

    const next = setDocument(
      {
        ...getDocument(),
        markdown,
        review: {
          ...normalizeReview(review),
          title: review.title || titleFromMarkdown(markdown),
          updatedAt
        }
      },
      "document:put"
    );

    sendJson(res, 200, next);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/message") {
    const body = await parseBody(req);
    if (body.document && typeof body.document === "object") {
      setDocument(
        {
          ...getDocument(),
          markdown: typeof body.document.markdown === "string" ? body.document.markdown : getDocument().markdown,
          review: body.document.review && typeof body.document.review === "object" ? body.document.review : getDocument().review
        },
        "document:agent-sync"
      );
    }

    const source = body.source === "thread" ? "thread" : "chat";
    const bodyText = typeof body.body === "string" ? body.body : "";
    const threadId = typeof body.threadId === "string" ? body.threadId : null;
    enqueueAgentTurn({ source, threadId, body: bodyText });
    sendJson(res, 202, getDocument());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/checkpoint") {
    await checkpoint();
    sendJson(res, 200, getDocument());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/export.md") {
    sendText(res, 200, getDocument().markdown, "text/markdown; charset=utf-8");
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      storage: "memory-first",
      runtime: agentRuntimeName,
      docId: defaultDocId,
      agentStatus: getDocument().agentSession.status
    });
    return true;
  }

  return false;
}

function enqueueAgentTurn(turn) {
  agentQueue.push({ ...turn, id: makeId("turn"), createdAt: nowIso() });
  updateSession({ queueDepth: agentQueue.length }, "agent:queued");
  void drainAgentQueue();
}

function updateSession(patch, reason) {
  updateDocument(
    (doc) => ({
      ...doc,
      agentSession: {
        ...doc.agentSession,
        ...patch,
        runtime: agentRuntimeName,
        updatedAt: nowIso()
      }
    }),
    reason
  );
}

async function drainAgentQueue() {
  if (agentRunning) return;
  agentRunning = true;

  while (agentQueue.length > 0) {
    const turn = agentQueue.shift();
    updateSession(
      {
        status: "running",
        queueDepth: agentQueue.length,
        activeTurn: {
          id: turn.id,
          source: turn.source,
          threadId: turn.threadId,
          createdAt: turn.createdAt
        },
        lastError: null
      },
      "agent:running"
    );

    try {
      const output = agentRuntimeName === "stub" ? await runStubAgent(turn) : await runCodexAgent(turn);
      applyAgentOutput(turn, output);
      updateSession(
        {
          status: "idle",
          turnCount: getDocument().agentSession.turnCount + 1,
          queueDepth: agentQueue.length,
          activeTurn: null,
          lastRunAt: nowIso(),
          lastError: null
        },
        "agent:complete"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      applyAgentOutput(turn, { reply: `Agent run failed: ${message}` });
      updateSession({ status: "error", queueDepth: agentQueue.length, activeTurn: null, lastError: message }, "agent:error");
    }
  }

  agentRunning = false;
  if (agentQueue.length > 0) void drainAgentQueue();
}

function summarizeProposalForContext(proposal) {
  const decisions = proposal?.changeDecisions && typeof proposal.changeDecisions === "object" ? proposal.changeDecisions : {};
  const decisionValues = Object.values(decisions);
  return {
    id: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    source: proposal.source,
    threadId: proposal.threadId ?? null,
    status: proposal.status,
    reviewedBlocks: decisionValues.length,
    acceptedBlocks: decisionValues.filter((decision) => decision === "accepted").length,
    rejectedBlocks: decisionValues.filter((decision) => decision === "rejected").length
  };
}

function buildAgentContextPacket(turn) {
  const doc = getDocument();
  const review = normalizeReview(doc.review);
  const openThreads = review.threads.filter((thread) => thread.status === "open");
  const activeThread = turn.threadId ? review.threads.find((thread) => thread.id === turn.threadId) : null;
  const contextLedger = review.contextLedger;
  const relevantLedger = contextLedger.filter(
    (event) =>
      (turn.threadId && event.threadId === turn.threadId) ||
      (event.type || "").startsWith("proposal") ||
      event.type === "thread_suggestion_decision"
  );
  const decisionLedger = contextLedger.filter(
    (event) =>
      event.type === "proposal_decision" ||
      event.type === "proposal_change_decision" ||
      event.type === "thread_suggestion_decision" ||
      event.type === "thread_status"
  );

  return {
    document: {
      id: doc.id ?? defaultDocId,
      title: review.title || titleFromMarkdown(doc.markdown),
      words: doc.markdown.split(/\s+/).filter(Boolean).length,
      updatedAt: review.updatedAt
    },
    currentTurn: turn,
    activeThread,
    openThreads,
    resolvedThreadCount: review.threads.filter((thread) => thread.status === "resolved").length,
    recentChat: review.chat.slice(-20),
    openProposals: review.proposals
      .filter((proposal) => proposal.status === "open" || proposal.status === "reviewed")
      .slice(-12)
      .map(summarizeProposalForContext),
    contextMemory: {
      recentLedger: contextLedger.slice(-50),
      relevantLedger: relevantLedger.slice(-35),
      decisionLedger: decisionLedger.slice(-50)
    }
  };
}

function buildAgentPrompt(turn) {
  const doc = getDocument();
  const contextPacket = buildAgentContextPacket(turn);

  return `You are Skribe's local writing partner for one Markdown document.

Rules:
- Do not edit files.
- Reply only as valid JSON. No Markdown fences.
- Be concise and specific.
- For anchored thread comments, reply in the thread and include a suggested replacement when useful.
- Suggestions must preserve the author's voice and should replace only the selected text unless the user asks for broader structure.
- For chat turns, you may propose broader document edits when the user asks for structural, strategic, or article-wide revision.
- Broad edits must be reviewable proposals, not silent edits. Include the full proposed Markdown in replacementMarkdown.
- The app renders replacementMarkdown with a Diffs.com review UI. The user can accept, decline, or ask you to revise each diff block.
- When the user asks you to revise one proposal block, return a new documentProposals entry with a revised full replacementMarkdown.
- Treat Context Memory as durable editorial memory. It contains previous human decisions, accepted/declined changes, revision requests, thread state changes, and agent outputs.
- Respect prior accepted/rejected decisions unless the current user explicitly asks you to revisit them.

Output shape:
{
  "reply": "short answer for the active chat or thread",
  "threadReplies": [{"threadId": "thread id", "body": "reply text"}],
  "suggestions": [{"threadId": "thread id", "replacement": "replacement text"}],
  "documentProposals": [{"title": "short title", "summary": "what changes and why", "replacementMarkdown": "full proposed Markdown document"}],
  "chatReply": "optional article-level chat response"
}

Agent context packet:
${JSON.stringify(contextPacket, null, 2)}

Current Markdown:
${doc.markdown}
`;
}

async function runCodexAgent(turn) {
  const outputPath = join(docDir, `.agent-output-${turn.id}.json`);
  const prompt = buildAgentPrompt(turn);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-C",
    docDir,
    "-o",
    outputPath,
    "-"
  ];

  await appendEvent({ type: "agent:spawn", at: nowIso(), args: ["codex", ...args] });

  const result = await runProcess("codex", args, prompt, 180000);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `codex exited with ${result.code}`);
  }

  const finalText = existsSync(outputPath) ? await readFile(outputPath, "utf8") : result.stdout;
  await appendEvent({
    type: "agent:raw-output",
    at: nowIso(),
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-4000),
    finalText: finalText.slice(-4000)
  });

  return parseAgentOutput(finalText);
}

async function runStubAgent(turn) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (turn.source === "thread") {
    return {
      reply: "I read this anchored note. I would tighten the selected passage and keep the revision local to this paragraph.",
      threadReplies: [
        {
          threadId: turn.threadId,
          body: "I read this anchored note. I would tighten the selected passage and keep the revision local to this paragraph."
        }
      ]
    };
  }
  if (/rewrite|revise|edit|tighten|proposal|pass/i.test(turn.body || "")) {
    const doc = getDocument();
    return {
      chatReply: "I drafted a reviewable document-level proposal.",
      documentProposals: [
        {
          title: "Stub document edit",
          summary: "A test proposal proving chat can create whole-document edits.",
          replacementMarkdown: doc.markdown
        }
      ]
    };
  }
  return { chatReply: "I am ready for an article-level pass. Add anchored comments for line edits or ask me for a structural pass here." };
}

function runProcess(command, args, stdin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: docDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`agent command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function parseAgentOutput(text) {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```json\s*([\s\S]*?)```/)?.[1],
    trimmed.match(/```\s*([\s\S]*?)```/)?.[1],
    trimmed.match(/\{[\s\S]*\}/)?.[0]
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return typeof parsed === "object" && parsed ? parsed : { reply: trimmed };
    } catch {
      // Try the next candidate.
    }
  }

  return { reply: trimmed || "I did not receive a usable agent response." };
}

function applyAgentOutput(turn, output) {
  const createdAt = nowIso();
  updateDocument((doc) => {
    const threadReplies = Array.isArray(output.threadReplies) ? output.threadReplies : [];
    const suggestions = Array.isArray(output.suggestions) ? output.suggestions : [];
    const documentProposals = Array.isArray(output.documentProposals)
      ? output.documentProposals
      : output.documentProposal
        ? [output.documentProposal]
        : [];
    const fallbackReply = typeof output.reply === "string" ? output.reply.trim() : "";
    const chatReply = typeof output.chatReply === "string" ? output.chatReply.trim() : "";
    const ledgerEvents = [];

    const nextThreads = doc.review.threads.map((thread) => {
      const repliesForThread = threadReplies.filter((reply) => reply.threadId === thread.id && reply.body);
      const fallbackForThread = turn.source === "thread" && turn.threadId === thread.id && fallbackReply ? [fallbackReply] : [];
      const suggestionForThread = suggestions.filter((suggestion) => suggestion.threadId === thread.id && suggestion.replacement);

      if (repliesForThread.length === 0 && fallbackForThread.length === 0 && suggestionForThread.length === 0) {
        return thread;
      }
      repliesForThread.forEach((reply) => {
        ledgerEvents.push(
          makeLedgerEvent({
            type: "agent_reply",
            actor: "agent",
            summary: `Agent replied to thread on "${thread.anchor.exact}": ${reply.body}`,
            createdAt,
            threadId: thread.id
          })
        );
      });
      fallbackForThread.forEach((body) => {
        ledgerEvents.push(
          makeLedgerEvent({
            type: "agent_reply",
            actor: "agent",
            summary: `Agent replied to thread on "${thread.anchor.exact}": ${body}`,
            createdAt,
            threadId: thread.id
          })
        );
      });
      suggestionForThread.forEach((suggestion) => {
        ledgerEvents.push(
          makeLedgerEvent({
            type: "thread_suggestion_created",
            actor: "agent",
            summary: `Agent suggested replacement for "${thread.anchor.exact}": ${suggestion.replacement}`,
            createdAt,
            threadId: thread.id
          })
        );
      });

      return {
        ...thread,
        messages: [
          ...thread.messages,
          ...repliesForThread.map((reply) => ({
            id: makeId("msg"),
            author: "agent",
            body: String(reply.body),
            createdAt
          })),
          ...fallbackForThread.map((body) => ({
            id: makeId("msg"),
            author: "agent",
            body,
            createdAt
          }))
        ],
        suggestions: [
          ...thread.suggestions,
          ...suggestionForThread.map((suggestion) => ({
            id: makeId("sug"),
            threadId: thread.id,
            type: "replace",
            original: thread.anchor.exact,
            replacement: String(suggestion.replacement),
            status: "open",
            author: "agent",
            createdAt
          }))
        ],
        updatedAt: createdAt
      };
    });

    const nextChat = [...doc.review.chat];
    if (turn.source === "chat" && (chatReply || fallbackReply)) {
      nextChat.push({
        id: makeId("chat"),
        author: "agent",
        body: chatReply || fallbackReply,
        createdAt
      });
      ledgerEvents.push(
        makeLedgerEvent({
          type: "agent_reply",
          actor: "agent",
          summary: `Agent chat reply: ${chatReply || fallbackReply}`,
          createdAt
        })
      );
    }

    const createdProposals = documentProposals
      .filter((proposal) => proposal && typeof proposal.replacementMarkdown === "string" && proposal.replacementMarkdown.trim())
      .map((proposal) => ({
        id: makeId("proposal"),
        source: turn.source,
        threadId: turn.threadId,
        title: String(proposal.title || (turn.source === "thread" ? "Thread edit proposal" : "Document edit proposal")),
        summary: String(proposal.summary || "Review the proposed Markdown replacement before accepting."),
        originalMarkdown: doc.markdown,
        replacementMarkdown: String(proposal.replacementMarkdown),
        status: "open",
        changeDecisions: {},
        author: "agent",
        createdAt
      }));
    createdProposals.forEach((proposal) => {
      ledgerEvents.push(
        makeLedgerEvent({
          type: "proposal_created",
          actor: "agent",
          summary: `Agent created proposal "${proposal.title}": ${proposal.summary}`,
          createdAt,
          threadId: proposal.threadId,
          proposalId: proposal.id
        })
      );
    });

    const nextProposals = [...doc.review.proposals, ...createdProposals];

    return {
      ...doc,
      review: {
        ...doc.review,
        threads: nextThreads,
        chat: nextChat,
        proposals: nextProposals,
        contextLedger: appendLedgerEvents(doc.review.contextLedger, ledgerEvents),
        updatedAt: createdAt
      }
    };
  }, "agent:applied");
}

function serveStatic(req, res) {
  let requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (requestPath === "/") requestPath = "/index.html";

  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(join(distDir, safePath));
  if (!filePath.startsWith(distDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    filePath = join(distDir, "index.html");
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
  });
  createReadStream(filePath).pipe(res);
}

await loadDocumentIntoMemory();

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (!handled) sendJson(res, 404, { error: "Not found" });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Skribe running at http://127.0.0.1:${port}`);
  console.log(`Storage: memory-first, checkpointed under ${docDir}`);
  console.log(`Agent runtime: ${agentRuntimeName}`);
});
