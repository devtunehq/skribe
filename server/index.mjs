import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const dataDir = join(root, "data");
const docsDir = join(dataDir, "docs");
const defaultDocId = "default";
const distDir = join(root, "dist");
const legacyDraftPath = join(dataDir, "draft.md");
const legacyReviewPath = join(dataDir, "review.json");
const registryPath = join(dataDir, "registry.json");
const defaultConfiguredRuntime = normalizeConfiguredRuntime(process.env.SKRIBE_AGENT_RUNTIME || "auto");
const defaultConfiguredModel = normalizeConfiguredModel(process.env.SKRIBE_AGENT_MODEL || "auto");
const agentTimeoutMs = Number(process.env.SKRIBE_AGENT_TIMEOUT_MS || 600000);
const port = Number(process.env.PORT || 4327);
const skillRegistryTtlMs = 30000;
const runtimeRegistryTtlMs = 30000;
const activeDocument = resolveActiveDocument(requestedDocumentPath());

const defaultMarkdown = `# Untitled Draft

Start writing here, or import a Markdown file.

Highlight any sentence or paragraph in the canvas to start a thread. Suggestions and chat stay in local review state, while this Markdown file remains clean for export.
`;

const defaultReview = {
  version: 1,
  title: "Untitled Draft",
  settings: {
    editorLanguage: "en-GB"
  },
  threads: [],
  chat: [],
  proposals: [],
  contextLedger: [],
  updatedAt: new Date().toISOString()
};

const defaultSession = {
  id: defaultDocId,
  runtime: defaultConfiguredRuntime === "auto" ? "auto" : defaultConfiguredRuntime,
  configuredRuntime: defaultConfiguredRuntime,
  model: defaultConfiguredModel === "auto" ? null : defaultConfiguredModel,
  configuredModel: defaultConfiguredModel,
  status: "idle",
  turnCount: 0,
  queueDepth: 0,
  activeTurn: null,
  lastRunAt: null,
  lastError: null,
  updatedAt: new Date().toISOString()
};

const defaultRevisionState = {
  version: 1,
  currentRevisionId: null,
  revisions: []
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
const falseProposalDisabledPattern =
  /\b(?:document proposals?\s+(?:are|is)\s+disabled|can't\s+(?:show|return|create)[^.]*\b(?:diff|proposal)[^.]*\b(?:mode|disabled)|can't\s+return\s+a\s+reviewable\s+full[- ]document\s+diff\s+in\s+this\s+mode)\b/i;
let checkpointTimer = null;
let documentMemory = null;
let agentRunning = false;
let skillRegistryCache = null;
let skillRegistryCachedAt = 0;
let runtimeRegistryCache = null;
let runtimeRegistryCachedAt = 0;

async function ensureDocumentFiles() {
  await mkdir(activeDocument.docDir, { recursive: true });
  await mkdir(activeDocument.snapshotsDir, { recursive: true });
  await mkdir(dirname(activeDocument.markdownPath), { recursive: true });

  if (!existsSync(activeDocument.markdownPath)) {
    const markdown =
      activeDocument.source === "internal" && existsSync(legacyDraftPath)
        ? await readFile(legacyDraftPath, "utf8")
        : defaultMarkdown;
    await writeFile(activeDocument.markdownPath, markdown, "utf8");
  }

  if (!existsSync(activeDocument.reviewPath)) {
    const markdown = await readFile(activeDocument.markdownPath, "utf8");
    const fallbackReview = {
      ...defaultReview,
      title: titleFromMarkdown(markdown) === "Untitled Draft" ? activeDocument.title : titleFromMarkdown(markdown),
      updatedAt: nowIso()
    };
    const review = activeDocument.source === "internal" && existsSync(legacyReviewPath)
      ? await readJson(legacyReviewPath, defaultReview)
      : fallbackReview;
    await writeFile(activeDocument.reviewPath, JSON.stringify(normalizeReview(review), null, 2), "utf8");
  }

  if (!existsSync(activeDocument.sessionPath)) {
    await writeFile(activeDocument.sessionPath, JSON.stringify({ ...defaultSession, id: activeDocument.id }, null, 2), "utf8");
  }

  if (!existsSync(activeDocument.eventsPath)) {
    await writeFile(activeDocument.eventsPath, "", "utf8");
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { ...fallback };
  }
}

function normalizeConfiguredRuntime(value) {
  const runtime = String(value || "").trim().toLowerCase();
  return runtime || "auto";
}

function normalizeConfiguredModel(value) {
  const model = String(value || "").trim();
  return model || "auto";
}

function sessionConfiguredRuntime(session) {
  return normalizeConfiguredRuntime(session?.configuredRuntime || session?.runtime || defaultConfiguredRuntime);
}

function sessionConfiguredModel(session) {
  return normalizeConfiguredModel(session?.configuredModel || session?.model || defaultConfiguredModel);
}

function normalizeAgentSession(session, { queueDepth = agentQueue.length } = {}) {
  const configuredRuntime = sessionConfiguredRuntime(session);
  const configuredModel = sessionConfiguredModel(session);
  const runtime = normalizeConfiguredRuntime(session?.runtime || (configuredRuntime === "auto" ? "auto" : configuredRuntime));

  return {
    ...defaultSession,
    ...(session && typeof session === "object" ? session : {}),
    id: activeDocument.id,
    runtime,
    configuredRuntime,
    model: configuredModel === "auto" ? null : configuredModel,
    configuredModel,
    queueDepth
  };
}

function requestedDocumentPath() {
  const envPath = process.env.SKRIBE_DOCUMENT || process.env.SKRIBE_DOCUMENT_PATH;
  if (envPath) return envPath;
  return process.argv.slice(2).find((arg) => arg && !arg.startsWith("-")) ?? null;
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function titleFromPath(path) {
  const name = basename(path).replace(/\.(md|markdown)$/i, "").trim();
  return name || "Untitled Draft";
}

function buildDocumentPaths({ id, source, markdownPath, title }) {
  const docDir = source === "internal" ? join(docsDir, id) : join(dataDir, "external", id);
  const snapshotsDir = join(docDir, "snapshots");
  return {
    id,
    source,
    title,
    markdownPath,
    docDir,
    reviewPath: join(docDir, "review.json"),
    sessionPath: join(docDir, "session.json"),
    eventsPath: join(docDir, "events.jsonl"),
    snapshotsDir,
    revisionsPath: join(snapshotsDir, "revisions.json")
  };
}

function resolveActiveDocument(markdownArg) {
  if (!markdownArg) {
    return buildDocumentPaths({
      id: defaultDocId,
      source: "internal",
      title: "Untitled Draft",
      markdownPath: join(docsDir, defaultDocId, "draft.md")
    });
  }

  const markdownPath = resolve(process.cwd(), markdownArg);
  return buildDocumentPaths({
    id: `file_${hashString(markdownPath)}`,
    source: "external",
    title: titleFromPath(markdownPath),
    markdownPath
  });
}

function slugSkillName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseSkillFrontmatter(markdown, fallbackName) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const fields = {};
  if (match) {
    for (const line of match[1].split("\n")) {
      const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (field) fields[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
    }
  }

  const headingName = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: fields.name || fallbackName || headingName || "unnamed-skill",
    description: fields.description || markdown.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ""
  };
}

function defaultSkillRoots() {
  const home = process.env.HOME || "";
  return [
    process.env.SKRIBE_SKILL_ROOTS,
    home ? join(home, ".agents", "skills") : null,
    home ? join(home, ".codex", "skills") : null,
    home ? join(home, ".codex", "plugins", "cache") : null
  ]
    .filter(Boolean)
    .flatMap((entry) => String(entry).split(delimiter))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function skillSourceForPath(path) {
  if (path.includes(`${join(".codex", "plugins", "cache")}`) || path.includes("/.codex/plugins/cache/")) return "plugin";
  if (path.includes("/.agents/skills/") || path.includes("/.codex/skills/")) return "local";
  return "configured";
}

async function findSkillFiles(rootPath, maxDepth = 7, maxFiles = 500) {
  const files = [];

  async function walk(dir, depth) {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      files.push(join(dir, "SKILL.md"));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "data") continue;
      await walk(join(dir, entry.name), depth + 1);
      if (files.length >= maxFiles) return;
    }
  }

  await walk(rootPath, 0);
  return files;
}

async function discoverAgentSkills({ force = false } = {}) {
  const now = Date.now();
  if (!force && skillRegistryCache && now - skillRegistryCachedAt < skillRegistryTtlMs) return skillRegistryCache;

  const roots = Array.from(new Set(defaultSkillRoots()));
  const skillFiles = [];
  for (const rootPath of roots) {
    skillFiles.push(...(await findSkillFiles(rootPath)));
  }

  const byId = new Map();
  for (const skillPath of skillFiles) {
    try {
      const markdown = await readFile(skillPath, "utf8");
      const fallbackName = skillPath.split("/").at(-2) || "skill";
      const parsed = parseSkillFrontmatter(markdown, fallbackName);
      const id = slugSkillName(parsed.name);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        name: parsed.name,
        description: parsed.description,
        source: skillSourceForPath(skillPath)
      });
    } catch {
      // Ignore unreadable skills; the registry should be best-effort.
    }
  }

  const skills = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  skillRegistryCache = skills;
  skillRegistryCachedAt = now;
  return skills;
}

async function enrichSelectedSkills(selectedSkills) {
  const registry = await discoverAgentSkills();
  const byId = new Map(registry.map((skill) => [skill.id, skill]));
  return selectedSkills.map((skill) => {
    const registered = byId.get(skill.id);
    return {
      ...skill,
      name: registered?.name || skill.name,
      description: registered?.description || "",
      source: registered?.source || "unknown"
    };
  });
}

function runtimePriority() {
  const configured = process.env.SKRIBE_AGENT_RUNTIME_PRIORITY || "codex,claude";
  return configured
    .split(",")
    .map((item) => normalizeConfiguredRuntime(item))
    .filter(Boolean);
}

function parseHelpModels(helpText, patterns) {
  const models = [];
  for (const pattern of patterns) {
    const match = helpText.match(pattern);
    if (!match) continue;
    const values = match.slice(1).flatMap((value) => String(value || "").split(/[,|/]\s*/));
    for (const value of values) {
      const model = value.replace(/['"`().]/g, "").trim();
      if (model && !models.some((item) => item.id === model)) {
        models.push({ id: model, label: model, source: "help" });
      }
    }
  }
  return models;
}

async function detectCommandRuntime({ id, label, command, modelPatterns = [] }) {
  const versionResult = await runProcessNoThrow(command, ["--version"], "", 3500, { cwd: root });
  if (versionResult.error) {
    return {
      id,
      label,
      command,
      available: false,
      version: null,
      supportsModelFlag: false,
      supportsStructuredOutput: false,
      supportsManualModel: false,
      models: [],
      defaultModel: null,
      notes: [`${label} executable not found or not runnable.`]
    };
  }

  const helpResult = await runProcessNoThrow(command, ["--help"], "", 5000, { cwd: root });
  const helpText = `${helpResult.stdout || ""}\n${helpResult.stderr || ""}`;
  const version = `${versionResult.stdout || versionResult.stderr || ""}`.trim() || null;
  const supportsModelFlag = /\s--model(?:\s|,|$)|\s-m,\s*--model/.test(helpText);

  return {
    id,
    label,
    command,
    available: true,
    version,
    supportsModelFlag,
    supportsStructuredOutput: /--json-schema|--output-schema/.test(helpText),
    supportsManualModel: supportsModelFlag,
    models: supportsModelFlag ? parseHelpModels(helpText, modelPatterns) : [],
    defaultModel: null,
    notes: supportsModelFlag
      ? ["CLI supports a model flag, but does not expose a reliable complete model list. Manual model ids are allowed."]
      : ["CLI does not appear to expose model selection."]
  };
}

async function detectCodexRuntime() {
  return detectCommandRuntime({
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    modelPatterns: []
  });
}

async function detectClaudeRuntime() {
  return detectCommandRuntime({
    id: "claude",
    label: "Claude Code",
    command: "claude",
    modelPatterns: [/alias(?:es)?[^()]*\((?:e\.g\.\s*)?['"]?([a-z0-9:_-]+)['"]?\s+or\s+['"]?([a-z0-9:_-]+)['"]?\)/i]
  });
}

async function detectStubRuntime() {
  return {
    id: "stub",
    label: "Stub Agent",
    command: null,
    available: true,
    version: "local",
    supportsModelFlag: false,
    supportsStructuredOutput: true,
    supportsManualModel: false,
    models: [],
    defaultModel: null,
    notes: ["Local test runtime. It does not call an external model."]
  };
}

const agentRuntimeAdapters = {
  stub: {
    id: "stub",
    label: "Stub Agent",
    detect: detectStubRuntime,
    run: async ({ turn }) => runStubAgent(turn)
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    detect: detectCodexRuntime,
    run: runCodexAgent
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    detect: detectClaudeRuntime,
    run: runClaudeAgent
  }
};

async function detectAgentRuntimes({ force = false } = {}) {
  const now = Date.now();
  if (!force && runtimeRegistryCache && now - runtimeRegistryCachedAt < runtimeRegistryTtlMs) return runtimeRegistryCache;

  const statuses = [];
  for (const adapter of Object.values(agentRuntimeAdapters)) {
    try {
      statuses.push(await adapter.detect());
    } catch (error) {
      statuses.push({
        id: adapter.id,
        label: adapter.label,
        command: adapter.id,
        available: false,
        version: null,
        supportsModelFlag: false,
        supportsStructuredOutput: false,
        supportsManualModel: false,
        models: [],
        defaultModel: null,
        notes: [error instanceof Error ? error.message : String(error)]
      });
    }
  }

  runtimeRegistryCache = statuses;
  runtimeRegistryCachedAt = now;
  return statuses;
}

function selectedModelForSession(session) {
  const configuredModel = sessionConfiguredModel(session);
  return configuredModel === "auto" ? null : configuredModel;
}

async function resolveAgentRuntimeSelection(session) {
  const configuredRuntime = sessionConfiguredRuntime(session);
  const statuses = await detectAgentRuntimes();
  const byId = new Map(statuses.map((status) => [status.id, status]));
  const runtimeId =
    configuredRuntime === "auto"
      ? runtimePriority().find((id) => byId.get(id)?.available) ?? null
      : configuredRuntime;
  const status = runtimeId ? byId.get(runtimeId) : null;
  const adapter = runtimeId ? agentRuntimeAdapters[runtimeId] : null;

  if (!runtimeId || !status || !adapter) {
    throw new Error("No supported agent runtime is configured.");
  }
  if (!status.available) {
    throw new Error(`${status.label || runtimeId} is not available. ${status.notes?.[0] || "Check the CLI installation."}`);
  }

  const model = selectedModelForSession(session);
  if (model && !status.supportsManualModel) {
    throw new Error(`${status.label || runtimeId} does not support model selection.`);
  }

  return {
    adapter,
    status,
    configuredRuntime,
    configuredModel: sessionConfiguredModel(session),
    model
  };
}

async function agentRuntimeConfigResponse() {
  const session = normalizeAgentSession(getDocument().agentSession);
  const runtimes = await detectAgentRuntimes();
  const byId = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
  const resolvedRuntime =
    session.configuredRuntime === "auto"
      ? runtimePriority().find((id) => byId.get(id)?.available) ?? null
      : byId.has(session.configuredRuntime)
        ? session.configuredRuntime
        : null;

  return {
    configuredRuntime: session.configuredRuntime,
    resolvedRuntime,
    configuredModel: session.configuredModel,
    resolvedModel: session.configuredModel === "auto" ? null : session.configuredModel,
    runtimes
  };
}

async function loadDocumentIntoMemory() {
  await ensureDocumentFiles();
  const [markdown, review, agentSession, draftStat, reviewStat] = await Promise.all([
    readFile(activeDocument.markdownPath, "utf8"),
    readJson(activeDocument.reviewPath, defaultReview),
    readJson(activeDocument.sessionPath, defaultSession),
    stat(activeDocument.markdownPath),
    stat(activeDocument.reviewPath)
  ]);

  const normalizedSession = normalizeAgentSession(agentSession);
  const restoredSession =
    normalizedSession.status === "running"
      ? {
          ...normalizedSession,
          status: "idle",
          queueDepth: agentQueue.length,
          activeTurn: null,
          lastError: "Previous agent run was interrupted before it completed. Ask the agent again to retry.",
          updatedAt: new Date().toISOString()
        }
      : {
          ...normalizedSession,
          status: normalizedSession.status === "error" ? "idle" : normalizedSession.status,
          queueDepth: agentQueue.length,
          activeTurn: normalizedSession.status === "running" ? normalizedSession.activeTurn : null
        };

  documentMemory = {
    id: activeDocument.id,
    markdown,
    review: normalizeReview(review),
    agentSession: restoredSession,
    fileInfo: {
      docId: activeDocument.id,
      source: activeDocument.source,
      title: activeDocument.title,
      markdownPath: activeDocument.markdownPath,
      displayPath: activeDocument.markdownPath,
      docDir: activeDocument.docDir,
      draftPath: activeDocument.markdownPath,
      reviewPath: activeDocument.reviewPath,
      sessionPath: activeDocument.sessionPath,
      eventsPath: activeDocument.eventsPath,
      draftUpdatedAt: draftStat.mtime.toISOString(),
      reviewUpdatedAt: reviewStat.mtime.toISOString()
    }
  };

  await ensureRevisionHistory(markdown, documentMemory.review.title);
  await touchDocumentRegistry();

  return documentMemory;
}

function normalizeReview(review) {
  const requestedLanguage = review?.settings?.editorLanguage;
  const editorLanguage = requestedLanguage === "en-US" || requestedLanguage === "en-GB" ? requestedLanguage : "en-GB";

  return {
    ...defaultReview,
    ...review,
    settings: {
      ...defaultReview.settings,
      ...(review?.settings && typeof review.settings === "object" ? review.settings : {}),
      editorLanguage
    },
    threads: Array.isArray(review?.threads) ? review.threads : [],
    chat: Array.isArray(review?.chat) ? review.chat : [],
    proposals: Array.isArray(review?.proposals) ? review.proposals : [],
    contextLedger: Array.isArray(review?.contextLedger) ? review.contextLedger : []
  };
}

function titleFromMarkdown(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Untitled Draft";
}

function hashMarkdown(markdown) {
  return createHash("sha256").update(markdown).digest("hex").slice(0, 16);
}

function revisionFilePath(revisionId) {
  return join(activeDocument.snapshotsDir, `${revisionId}.md`);
}

function countWords(markdown) {
  return markdown.split(/\s+/).filter(Boolean).length;
}

async function readRevisionState() {
  const raw = await readJson(activeDocument.revisionsPath, defaultRevisionState);
  const revisions = Array.isArray(raw?.revisions)
    ? raw.revisions
        .filter((revision) => revision && typeof revision.id === "string")
        .map((revision) => ({
          id: revision.id,
          parentId: typeof revision.parentId === "string" ? revision.parentId : null,
          createdAt: typeof revision.createdAt === "string" ? revision.createdAt : nowIso(),
          reason: typeof revision.reason === "string" ? revision.reason : "Saved draft",
          title: typeof revision.title === "string" ? revision.title : "Untitled Draft",
          words: Number.isFinite(revision.words) ? revision.words : 0,
          hash: typeof revision.hash === "string" ? revision.hash : ""
        }))
    : [];
  const currentRevisionId =
    typeof raw?.currentRevisionId === "string" && revisions.some((revision) => revision.id === raw.currentRevisionId)
      ? raw.currentRevisionId
      : revisions.at(-1)?.id ?? null;

  return {
    version: 1,
    currentRevisionId,
    revisions
  };
}

async function writeRevisionState(state) {
  await mkdir(activeDocument.snapshotsDir, { recursive: true });
  await atomicWrite(
    activeDocument.revisionsPath,
    JSON.stringify(
      {
        version: 1,
        currentRevisionId: state.currentRevisionId,
        revisions: state.revisions
      },
      null,
      2
    )
  );
}

async function setCurrentRevisionId(revisionId) {
  const state = await readRevisionState();
  if (!state.revisions.some((revision) => revision.id === revisionId)) return state;
  const nextState = {
    ...state,
    currentRevisionId: revisionId
  };
  await writeRevisionState(nextState);
  return nextState;
}

async function createRevision(markdown, { reason = "Saved draft", parentId = null, title = null } = {}) {
  const state = await readRevisionState();
  const current = state.revisions.find((revision) => revision.id === state.currentRevisionId) ?? null;
  const hash = hashMarkdown(markdown);

  if (current?.hash === hash) {
    return { state, revision: current, created: false };
  }

  const createdAt = nowIso();
  const revision = {
    id: makeId("rev"),
    parentId,
    createdAt,
    reason,
    title: title || titleFromMarkdown(markdown),
    words: countWords(markdown),
    hash
  };

  await mkdir(activeDocument.snapshotsDir, { recursive: true });
  await atomicWrite(revisionFilePath(revision.id), markdown);

  const nextState = {
    version: 1,
    currentRevisionId: revision.id,
    revisions: [...state.revisions, revision].slice(-100)
  };
  await writeRevisionState(nextState);
  return { state: nextState, revision, created: true };
}

async function ensureRevisionHistory(markdown, title = null) {
  const state = await readRevisionState();
  const displayTitle = title || titleFromMarkdown(markdown);
  if (state.revisions.length === 0) {
    await createRevision(markdown, { reason: "Initial draft", parentId: null, title: displayTitle });
    return;
  }

  const current = state.revisions.find((revision) => revision.id === state.currentRevisionId) ?? null;
  if (current && current.hash === hashMarkdown(markdown) && current.title === "Untitled Draft" && displayTitle !== "Untitled Draft") {
    await writeRevisionState({
      ...state,
      revisions: state.revisions.map((revision) =>
        revision.id === current.id ? { ...revision, title: displayTitle } : revision
      )
    });
    return;
  }

  if (!current || current.hash !== hashMarkdown(markdown)) {
    await createRevision(markdown, {
      reason: "Recovered draft",
      parentId: state.currentRevisionId,
      title: displayTitle
    });
  }
}

async function getRevisionResponse() {
  const state = await readRevisionState();
  return {
    currentRevisionId: state.currentRevisionId,
    revisions: [...state.revisions].reverse()
  };
}

async function touchDocumentRegistry({ saved = false } = {}) {
  const now = nowIso();
  const registry = await readJson(registryPath, { version: 1, recent: [] });
  const recent = Array.isArray(registry.recent) ? registry.recent : [];
  const existing = recent.find((entry) => entry?.id === activeDocument.id) ?? {};
  const entry = {
    ...existing,
    id: activeDocument.id,
    source: activeDocument.source,
    title: getDocument().review?.title || activeDocument.title,
    markdownPath: activeDocument.markdownPath,
    docDir: activeDocument.docDir,
    lastOpenedAt: existing.lastOpenedAt || now,
    lastSeenAt: now,
    lastSavedAt: saved ? now : existing.lastSavedAt || null
  };
  const nextRegistry = {
    version: 1,
    recent: [entry, ...recent.filter((item) => item?.id !== activeDocument.id)].slice(0, 30)
  };
  await mkdir(dataDir, { recursive: true });
  await atomicWrite(registryPath, JSON.stringify(nextRegistry, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isOlderTimestamp(candidate, current) {
  const candidateTime = Date.parse(candidate || "");
  const currentTime = Date.parse(current || "");
  return Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime < currentTime;
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  return minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.round(ms / 1000)} seconds`;
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
    agentSession: normalizeAgentSession({ ...next.agentSession, updatedAt: nowIso() })
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
  await mkdir(activeDocument.docDir, { recursive: true });
  await mkdir(dirname(activeDocument.markdownPath), { recursive: true });
  await Promise.all([
    atomicWrite(activeDocument.markdownPath, snapshot.markdown),
    atomicWrite(activeDocument.reviewPath, JSON.stringify(snapshot.review, null, 2)),
    atomicWrite(activeDocument.sessionPath, JSON.stringify(snapshot.agentSession, null, 2))
  ]);
  const [draftStat, reviewStat] = await Promise.all([stat(activeDocument.markdownPath), stat(activeDocument.reviewPath)]);
  documentMemory = {
    ...snapshot,
    fileInfo: {
      ...snapshot.fileInfo,
      draftUpdatedAt: draftStat.mtime.toISOString(),
      reviewUpdatedAt: reviewStat.mtime.toISOString()
    }
  };
  await touchDocumentRegistry({ saved: true });
}

async function atomicWrite(path, content) {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, path);
}

async function appendEvent(event) {
  await writeFile(activeDocument.eventsPath, `${JSON.stringify(event)}\n`, { flag: "a" });
}

function broadcast(type, payload) {
  const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    if (res.destroyed || res.writableEnded) {
      subscribers.delete(res);
      continue;
    }

    try {
      res.write(event, (error) => {
        if (!error) return;
        subscribers.delete(res);
        res.destroy(error);
      });
    } catch {
      subscribers.delete(res);
      res.destroy();
    }
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
  const cleanup = () => subscribers.delete(res);
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

async function handleApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/api/document") {
    sendJson(res, 200, getDocument());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/skills") {
    sendJson(res, 200, { skills: await discoverAgentSkills() });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/agent/runtimes") {
    sendJson(res, 200, await agentRuntimeConfigResponse());
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/agent/config") {
    if (agentRunning || getDocument().agentSession?.status === "running") {
      sendJson(res, 409, { error: "Cannot change agent runtime while an agent turn is running." });
      return true;
    }

    const body = await parseBody(req);
    const configuredRuntime = normalizeConfiguredRuntime(body.runtime);
    const configuredModel = normalizeConfiguredModel(body.model);

    if (configuredRuntime !== "auto" && !agentRuntimeAdapters[configuredRuntime]) {
      sendJson(res, 400, { error: `Unknown agent runtime "${configuredRuntime}".` });
      return true;
    }

    const runtimes = await detectAgentRuntimes({ force: true });
    const byId = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
    const selectedRuntime =
      configuredRuntime === "auto" ? runtimePriority().find((id) => byId.get(id)?.available) ?? null : configuredRuntime;
    const selectedStatus = selectedRuntime ? byId.get(selectedRuntime) : null;

    if (configuredRuntime !== "auto" && selectedStatus && !selectedStatus.available) {
      sendJson(res, 400, { error: `${selectedStatus.label} is not available.` });
      return true;
    }
    if (configuredModel !== "auto" && selectedStatus && !selectedStatus.supportsManualModel) {
      sendJson(res, 400, { error: `${selectedStatus.label} does not support model selection.` });
      return true;
    }

    updateSession(
      {
        configuredRuntime,
        runtime: selectedRuntime || configuredRuntime,
        configuredModel,
        model: configuredModel === "auto" ? null : configuredModel,
        lastError: null
      },
      "agent:config"
    );
    await checkpoint();

    sendJson(res, 200, {
      document: getDocument(),
      config: await agentRuntimeConfigResponse()
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/revisions") {
    sendJson(res, 200, await getRevisionResponse());
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
    const previousMarkdown = getDocument().markdown;
    const currentUpdatedAt = getDocument().review?.updatedAt;
    const incomingUpdatedAt = review.updatedAt;

    if (isOlderTimestamp(incomingUpdatedAt, currentUpdatedAt)) {
      sendJson(res, 409, {
        error: "Stale document save rejected",
        document: getDocument(),
        revisions: await getRevisionResponse()
      });
      return true;
    }

    setDocument(
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

    if (markdown !== previousMarkdown) {
      await createRevision(markdown, {
        reason: "Saved draft",
        parentId: (await readRevisionState()).currentRevisionId,
        title: review.title || titleFromMarkdown(markdown)
      });
    }

    sendJson(res, 200, getDocument());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/revisions/restore") {
    const body = await parseBody(req);
    const revisionId = typeof body.revisionId === "string" ? body.revisionId : "";
    const revisionState = await readRevisionState();
    const revision = revisionState.revisions.find((item) => item.id === revisionId);

    if (!revision) {
      sendJson(res, 404, { error: "Revision not found" });
      return true;
    }

    let markdown;
    try {
      markdown = await readFile(revisionFilePath(revision.id), "utf8");
    } catch {
      sendJson(res, 404, { error: "Revision snapshot not found" });
      return true;
    }

    const createdAt = nowIso();
    const review = normalizeReview(getDocument().review);
    setDocument(
      {
        ...getDocument(),
        markdown,
        review: {
          ...review,
          title: revision.title || titleFromMarkdown(markdown),
          contextLedger: appendLedgerEvents(review.contextLedger, [
            makeLedgerEvent({
              type: "document_revision_restored",
              actor: "human",
              summary: `Restored document revision "${revision.title}" from ${revision.createdAt}.`,
              createdAt,
              metadata: {
                revisionId: revision.id,
                restoredWords: revision.words
              }
            })
          ]),
          updatedAt: createdAt
        }
      },
      "document:revision-restore"
    );

    await setCurrentRevisionId(revision.id);
    await checkpoint();

    sendJson(res, 200, {
      document: getDocument(),
      revisions: await getRevisionResponse()
    });
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
    const selectedSkills = Array.isArray(body.skills)
      ? body.skills
          .filter((skill) => skill && typeof skill.id === "string")
          .map((skill) => ({
            id: slugSkillName(skill.id),
            name: typeof skill.name === "string" ? skill.name : skill.id
          }))
          .filter((skill) => skill.id)
          .slice(0, 8)
      : [];
    const skills = await enrichSelectedSkills(selectedSkills);
    enqueueAgentTurn({ source, threadId, body: bodyText, skills });
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
    const session = normalizeAgentSession(getDocument().agentSession);
    sendJson(res, 200, {
      ok: true,
      storage: "memory-first",
      runtime: session.runtime,
      configuredRuntime: session.configuredRuntime,
      model: session.model,
      configuredModel: session.configuredModel,
      docId: activeDocument.id,
      documentSource: activeDocument.source,
      markdownPath: activeDocument.markdownPath,
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
      agentSession: normalizeAgentSession({ ...doc.agentSession, ...patch, updatedAt: nowIso() })
    }),
    reason
  );
}

async function drainAgentQueue() {
  if (agentRunning) return;
  agentRunning = true;

  while (agentQueue.length > 0) {
    const turn = agentQueue.shift();

    try {
      const runtimeSelection = await resolveAgentRuntimeSelection(getDocument().agentSession);
      updateSession(
        {
          status: "running",
          runtime: runtimeSelection.status.id,
          model: runtimeSelection.model,
          configuredRuntime: runtimeSelection.configuredRuntime,
          configuredModel: runtimeSelection.configuredModel,
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

      const output = await runAgentRuntime(turn, runtimeSelection);
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
      const reply = /timed out/i.test(message)
        ? `Agent run failed: timed out after ${formatDuration(agentTimeoutMs)}. The document was not changed. Try a narrower instruction or retry.`
        : `Agent run failed: ${message}`;
      applyAgentOutput(turn, { reply });
      updateSession({ status: "idle", queueDepth: agentQueue.length, activeTurn: null, lastError: message }, "agent:error");
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

function sanitizeAgentContextText(value) {
  const text = String(value || "");
  return falseProposalDisabledPattern.test(text)
    ? "[Previous agent response omitted because it incorrectly claimed document proposals were disabled. Current responsePolicy is authoritative.]"
    : text;
}

function sanitizeChatMessageForAgentContext(message) {
  if (!message || message.author !== "agent" || typeof message.body !== "string") return message;
  return {
    ...message,
    body: sanitizeAgentContextText(message.body)
  };
}

function sanitizeLedgerEventForAgentContext(event) {
  if (!event || typeof event.summary !== "string") return event;
  return {
    ...event,
    summary: sanitizeAgentContextText(event.summary)
  };
}

function sanitizeThreadForAgentContext(thread) {
  if (!thread || !Array.isArray(thread.messages)) return thread;
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message?.author === "agent" && typeof message.body === "string"
        ? {
            ...message,
            body: sanitizeAgentContextText(message.body)
          }
        : message
    )
  };
}

function isSkillOnlyTurn(turn) {
  const body = String(turn.body || "").trim();
  return (
    Array.isArray(turn.skills) &&
    turn.skills.length > 0 &&
    /^Apply\s+\/[a-z0-9:_-]+(?:,\s*\/[a-z0-9:_-]+)*\s+to the current writing context\./i.test(body)
  );
}

function latestAgentChatBody() {
  try {
    const chat = normalizeReview(getDocument().review).chat;
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      const message = chat[index];
      if (message?.author === "agent" && typeof message.body === "string") return message.body;
    }
  } catch {
    return "";
  }
  return "";
}

function latestAgentRequestedDocumentProposal() {
  return /\b(confirm|prepare|create|full[- ]document|full diff|reviewable|proposal|edit pass|document-level|return the reviewable|return the diff|show the diff)\b/i.test(
    latestAgentChatBody()
  );
}

function confirmsPendingDocumentProposal(body) {
  const confirmationSignal =
    /\b(proceed|go ahead|do it|yes|yep|yeah|ok|okay|confirm|confirmed|sounds good|looks good|fine|apply those|make those changes|show me|show the|send me|send the|return|give me)\b/.test(
      body
    );
  if (!confirmationSignal) return false;

  return latestAgentRequestedDocumentProposal();
}

function asksForDocumentProposal(turn) {
  const body = String(turn.body || "").toLowerCase();
  if (isSkillOnlyTurn(turn)) return false;

  const editVerb = /\b(rewrite|revise|edit|update|change|apply|make changes|humanize|polish|tighten|create|prepare|generate|produce)\b/.test(
    body
  );
  const broadTarget = /\b(doc|document|draft|article|essay|piece|whole|entire|all|across|full)\b/.test(body);
  const reviewArtifact =
    /\b(diff|proposal|proposed changes|reviewable edit|reviewable edits|reviewable changes|edit pass|change set)\b/.test(body);
  const explicitDiffRequest =
    /\b(show|send|return|give|create|prepare|generate|produce)\s+(?:me\s+)?(?:the\s+)?(?:full[- ]document\s+|reviewable\s+)?(?:diff|proposal|proposed changes|reviewable edit|reviewable edits|reviewable changes|edit pass|change set)\b/.test(
      body
    );
  const confirmationSignal = /\b(proceed|go ahead|do it|yes|confirm|confirmed|sounds good|looks good)\b/.test(body);

  return (
    (editVerb && (broadTarget || reviewArtifact)) ||
    explicitDiffRequest ||
    (reviewArtifact && latestAgentRequestedDocumentProposal()) ||
    (reviewArtifact && (confirmationSignal || broadTarget)) ||
    confirmsPendingDocumentProposal(body)
  );
}

function inferTurnIntent(turn) {
  if (isSkillOnlyTurn(turn)) return "skill_pass";
  if (asksForDocumentProposal(turn)) return turn.source === "thread" ? "thread_document_proposal" : "document_proposal";
  if (turn.source === "thread") return "anchored_thread";
  return "chat";
}

function buildResponsePolicy(turn) {
  const intent = inferTurnIntent(turn);
  const isSkillPass = intent === "skill_pass";
  const allowDocumentProposals = intent === "document_proposal" || intent === "thread_document_proposal" || isSkillPass;
  return {
    intent,
    allowDocumentProposals,
    maxDocumentProposals: allowDocumentProposals ? 1 : 0,
    skillProposalMode: isSkillPass ? "agent_decides_from_skill_instructions" : "not_applicable",
    maxReplyWords: intent === "skill_pass" ? 220 : intent === "thread_document_proposal" ? 120 : 180
  };
}

function clipAroundNeedle(text, needle, maxChars) {
  if (!needle || text.length <= maxChars) return text;
  const index = text.indexOf(needle);
  if (index < 0) return text.slice(0, maxChars);

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? "[... earlier document content omitted ...]\n\n" : "";
  const suffix = end < text.length ? "\n\n[... later document content omitted ...]" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function markdownForAgentTurn(turn) {
  const doc = getDocument();
  const policy = buildResponsePolicy(turn);
  const maxChars = Number(process.env.SKRIBE_AGENT_MARKDOWN_MAX_CHARS || 24000);
  if (doc.markdown.length <= maxChars) return doc.markdown;

  if (policy.intent === "anchored_thread") {
    const review = normalizeReview(doc.review);
    const activeThread = turn.threadId ? review.threads.find((thread) => thread.id === turn.threadId) : null;
    return clipAroundNeedle(doc.markdown, activeThread?.anchor?.exact, Math.min(maxChars, 9000));
  }

  return `${doc.markdown.slice(0, maxChars)}\n\n[... document clipped for agent context ...]`;
}

function buildAgentContextPacket(turn) {
  const doc = getDocument();
  const review = normalizeReview(doc.review);
  const responsePolicy = buildResponsePolicy(turn);
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
      id: doc.id ?? activeDocument.id,
      source: activeDocument.source,
      markdownPath: activeDocument.markdownPath,
      title: review.title || titleFromMarkdown(doc.markdown),
      words: doc.markdown.split(/\s+/).filter(Boolean).length,
      editorLanguage: review.settings?.editorLanguage ?? "en-GB",
      updatedAt: review.updatedAt
    },
    currentTurn: turn,
    responsePolicy,
    requestedSkills: Array.isArray(turn.skills) ? turn.skills : [],
    activeThread: sanitizeThreadForAgentContext(activeThread),
    openThreads: openThreads.map(sanitizeThreadForAgentContext),
    resolvedThreadCount: review.threads.filter((thread) => thread.status === "resolved").length,
    recentChat: review.chat.slice(-8).map(sanitizeChatMessageForAgentContext),
    openProposals: review.proposals
      .filter((proposal) => proposal.status === "open" || proposal.status === "reviewed")
      .slice(-5)
      .map(summarizeProposalForContext),
    contextMemory: {
      recentLedger: contextLedger.slice(-20).map(sanitizeLedgerEventForAgentContext),
      relevantLedger: relevantLedger.slice(-14).map(sanitizeLedgerEventForAgentContext),
      decisionLedger: decisionLedger.slice(-20).map(sanitizeLedgerEventForAgentContext)
    }
  };
}

function buildProposalModeInstruction(responsePolicy) {
  if (!responsePolicy.allowDocumentProposals) {
    return [
      "Proposal mode for this turn: DISABLED.",
      "Do not return documentProposals. Use chatReply or threadReplies instead."
    ].join("\n");
  }

  return [
    "Proposal mode for this turn: ENABLED.",
    "If the human asks for a diff, proposal, reviewable edit, concrete edit pass, or asks you to make changes, you MUST return exactly one documentProposals entry.",
    responsePolicy.intent === "thread_document_proposal"
      ? "This is an anchored thread turn. Use activeThread as the focus and create a documentProposals entry for the relevant passage or section in the full Markdown document."
      : "",
    "The environment being read-only only means you must not edit files. It does not prevent a proposal. A proposal is JSON text: full replacementMarkdown for Skribe to diff.",
    "Do not say that document proposals are disabled, unavailable, impossible, or not allowed in this mode.",
    "When returning documentProposals, apply your edits to Current Markdown and put the complete resulting Markdown document in replacementMarkdown."
  ].filter(Boolean).join("\n");
}

function buildAgentPrompt(turn) {
  const contextPacket = buildAgentContextPacket(turn);
  const currentMarkdown = markdownForAgentTurn(turn);
  const proposalModeInstruction = buildProposalModeInstruction(contextPacket.responsePolicy);

  return `You are Skribe's local writing partner for one Markdown document.

${proposalModeInstruction}

Rules:
- Do not edit files.
- Reply only as valid JSON. No Markdown fences.
- Be concise and specific.
- You have access to the configured agent runtime's local skills. If requestedSkills is non-empty, load and follow those skills before producing the JSON response.
- If the human names a skill in the message, or a skill clearly fits the writing task, use the runtime's skill mechanism when available.
- Apply skill guidance to your answer; do not paste long skill instructions back into Skribe.
- Respect document.editorLanguage for spelling conventions in replies and proposed edits.
- Follow responsePolicy exactly.
- If responsePolicy.allowDocumentProposals is false, do not return documentProposals. Use chatReply or threadReplies instead.
- If responsePolicy.intent is "skill_pass", load and follow the requested skill instructions, then decide from those instructions and the human's wording whether the skill is meant to transform/rewrite/edit the current draft or only advise/review/analyze.
- For transformational skill passes, return a documentProposals entry immediately with the full revised Markdown in replacementMarkdown. Do not ask for confirmation first when the skill itself is an instruction to rewrite, transform, humanize, adapt voice, copyedit, polish, or otherwise change the text.
- For advisory/review/analyze skill passes, return concise chatReply findings and ask before preparing a document-level diff unless the human explicitly asked for a diff/proposal.
- For anchored thread comments where responsePolicy.allowDocumentProposals is false, reply in the thread and include a suggested replacement when useful.
- For anchored thread comments where responsePolicy.allowDocumentProposals is true, return documentProposals instead of only suggestions. The proposal may be focused on the selected sentence, paragraph, or section implied by the thread.
- Suggestions must preserve the author's voice and should replace only the selected text unless the user asks for broader structure.
- For chat turns, propose broader document edits only when responsePolicy.allowDocumentProposals is true.
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
${currentMarkdown}
`;
}

async function runAgentRuntime(turn, runtimeSelection) {
  return runtimeSelection.adapter.run({
    turn,
    prompt: buildAgentPrompt(turn),
    model: runtimeSelection.model,
    timeoutMs: agentTimeoutMs
  });
}

async function runCodexAgent({ turn, prompt, model, timeoutMs }) {
  const outputPath = join(activeDocument.docDir, `.agent-output-${turn.id}.json`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-C",
    activeDocument.docDir,
    "-o",
    outputPath,
    "-"
  ];
  if (model) args.splice(1, 0, "--model", model);

  await appendEvent({ type: "agent:spawn", at: nowIso(), args: ["codex", ...args] });

  const result = await runProcess("codex", args, prompt, timeoutMs);
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

async function runClaudeAgent({ prompt, model, timeoutMs }) {
  const args = [
    "--print",
    "--output-format",
    "text",
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
    "--no-session-persistence"
  ];
  if (model) args.push("--model", model);

  await appendEvent({ type: "agent:spawn", at: nowIso(), args: ["claude", ...args] });

  const result = await runProcess("claude", args, prompt, timeoutMs);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `claude exited with ${result.code}`);
  }

  await appendEvent({
    type: "agent:raw-output",
    at: nowIso(),
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-4000),
    finalText: result.stdout.slice(-4000)
  });

  return parseAgentOutput(result.stdout);
}

async function runStubAgent(turn) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (turn.source === "thread" && asksForDocumentProposal(turn)) {
    const doc = getDocument();
    return {
      threadReplies: [
        {
          threadId: turn.threadId,
          body: "I drafted this as a reviewable editor diff."
        }
      ],
      documentProposals: [
        {
          title: "Thread edit proposal",
          summary: "A test proposal proving anchored threads can create editor diffs.",
          replacementMarkdown: doc.markdown
        }
      ]
    };
  }
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
  if (/rewrite|revise|edit|tighten|proposal|pass|diff|proceed|go ahead/i.test(turn.body || "")) {
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

async function runProcessNoThrow(command, args, stdin, timeoutMs, options = {}) {
  try {
    return await runProcess(command, args, stdin, timeoutMs, options);
  } catch (error) {
    return {
      code: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function runProcess(command, args, stdin, timeoutMs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || activeDocument.docDir,
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

function agentOutputText(output) {
  return [
    typeof output.reply === "string" ? output.reply : "",
    typeof output.chatReply === "string" ? output.chatReply : "",
    ...(Array.isArray(output.threadReplies) ? output.threadReplies.map((reply) => String(reply?.body || "")) : [])
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractReplacementQuotedText(value) {
  const text = String(value || "").trim();
  const quoted = text.match(/[“"]([\s\S]*?)[”"]/) ?? text.match(/[‘']([\s\S]*?)[’']/);
  return (quoted ? quoted[1] : text)
    .replace(/^[-*\s]+/, "")
    .replace(/\s+$/, "")
    .trim();
}

function parseReplaceWithEdits(text) {
  const lines = String(text || "").split(/\r?\n/);
  const edits = [];

  for (let index = 0; index < lines.length; index += 1) {
    const replaceMatch = lines[index].match(/\bReplace:\s*(.+)$/i);
    if (!replaceMatch) continue;

    let withText = "";
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 4); lookahead += 1) {
      const withMatch = lines[lookahead].match(/\bWith:\s*(.+)$/i);
      if (withMatch) {
        withText = withMatch[1];
        index = lookahead;
        break;
      }
      if (lines[lookahead].match(/\bReplace:\s*(.+)$/i)) break;
    }

    const original = extractReplacementQuotedText(replaceMatch[1]);
    const replacement = extractReplacementQuotedText(withText);
    if (original && replacement) edits.push({ original, replacement });
  }

  return edits;
}

function applySingleTextReplacement(markdown, original, replacement) {
  if (!original || original.includes("…") || original.includes("...")) return markdown;

  const candidates = Array.from(
    new Set([
      original,
      original.replace(/[’‘]/g, "'").replace(/[“”]/g, '"'),
      original.replace(/'/g, "’").replace(/"/g, "“")
    ])
  );

  for (const candidate of candidates) {
    const index = markdown.indexOf(candidate);
    if (index >= 0) return `${markdown.slice(0, index)}${replacement}${markdown.slice(index + candidate.length)}`;
  }

  const flexiblePattern = original.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  if (!flexiblePattern) return markdown;
  const match = markdown.match(new RegExp(flexiblePattern));
  if (!match || match.index === undefined) return markdown;

  return `${markdown.slice(0, match.index)}${replacement}${markdown.slice(match.index + match[0].length)}`;
}

function buildFallbackProposalFromReplaceWithEdits(turn, output, markdown) {
  if (!buildResponsePolicy(turn).allowDocumentProposals) return null;

  const text = agentOutputText(output);
  const edits = parseReplaceWithEdits(text);
  if (edits.length === 0) return null;

  let replacementMarkdown = markdown;
  let appliedCount = 0;
  for (const edit of edits) {
    const nextMarkdown = applySingleTextReplacement(replacementMarkdown, edit.original, edit.replacement);
    if (nextMarkdown !== replacementMarkdown) {
      replacementMarkdown = nextMarkdown;
      appliedCount += 1;
    }
  }

  if (appliedCount === 0 || replacementMarkdown === markdown) return null;

  return {
    title: "Concrete edit suggestions",
    summary: `Converted ${appliedCount} concrete Replace/With edit${appliedCount === 1 ? "" : "s"} from the agent reply into a reviewable proposal.`,
    replacementMarkdown
  };
}

function applyAgentOutput(turn, output) {
  const createdAt = nowIso();
  updateDocument((doc) => {
    const threadReplies = Array.isArray(output.threadReplies) ? output.threadReplies : [];
    const suggestions = Array.isArray(output.suggestions) ? output.suggestions : [];
    const rawDocumentProposals = Array.isArray(output.documentProposals)
      ? output.documentProposals
      : output.documentProposal
        ? [output.documentProposal]
        : [];
    const fallbackDocumentProposal =
      rawDocumentProposals.length === 0 ? buildFallbackProposalFromReplaceWithEdits(turn, output, doc.markdown) : null;
    const documentProposals = fallbackDocumentProposal ? [fallbackDocumentProposal] : rawDocumentProposals;
    const chatReply = typeof output.chatReply === "string" ? output.chatReply.trim() : "";
    const explicitReply = typeof output.reply === "string" ? output.reply.trim() : "";
    const fallbackReply = explicitReply || (turn.source === "thread" ? chatReply : "");
    const ledgerEvents = [];

    const nextThreads = doc.review.threads.map((thread) => {
      const repliesForThread = threadReplies.filter(
        (reply) =>
          reply.body &&
          (reply.threadId === thread.id || (turn.source === "thread" && turn.threadId === thread.id && !reply.threadId))
      );
      const fallbackForThread =
        turn.source === "thread" && turn.threadId === thread.id && repliesForThread.length === 0 && fallbackReply ? [fallbackReply] : [];
      const suggestionForThread = suggestions.filter(
        (suggestion) =>
          suggestion.replacement &&
          (suggestion.threadId === thread.id || (turn.source === "thread" && turn.threadId === thread.id && !suggestion.threadId))
      );

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
  console.log(`Document: ${activeDocument.markdownPath}`);
  console.log(`Review state: ${activeDocument.docDir}`);
  console.log(`Agent runtime: ${getDocument().agentSession.configuredRuntime}`);
  console.log(`Agent model: ${getDocument().agentSession.configuredModel}`);
});
