import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const legacyDataDir = join(root, "data");
const homeDir = process.env.HOME || process.env.USERPROFILE || root;
const appConfigDir = resolve(
  process.env.SKRIBE_CONFIG_DIR ||
    (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "skribe") : join(homeDir, ".config", "skribe"))
);
const settingsPath = join(appConfigDir, "settings.json");
const dataDir = resolve(process.env.SKRIBE_DATA_DIR || join(appConfigDir, "data"));
const docsDir = join(dataDir, "docs");
const defaultDocId = "default";
const distDir = join(root, "dist");
const legacyDraftPath = join(legacyDataDir, "draft.md");
const legacyReviewPath = join(legacyDataDir, "review.json");
const registryPath = join(dataDir, "registry.json");
const defaultConfiguredRuntime = normalizeConfiguredRuntime(process.env.SKRIBE_AGENT_RUNTIME || "auto");
const defaultConfiguredModel = normalizeConfiguredModel(process.env.SKRIBE_AGENT_MODEL || "auto");
const defaultConfiguredEffort = normalizeConfiguredEffort(
  process.env.SKRIBE_AGENT_EFFORT || process.env.SKRIBE_AGENT_REASONING_EFFORT || "auto"
);
const agentTimeoutMs = Number(process.env.SKRIBE_AGENT_TIMEOUT_MS || 600000);
const toneOfVoiceMaxChars = Math.max(1200, Number(process.env.SKRIBE_TONE_OF_VOICE_MAX_CHARS || 6000));
const port = Number(process.env.PORT || 4327);
const host = "127.0.0.1";
const appUrl = `http://${host}:${port}`;
const skillRegistryTtlMs = 30000;
const runtimeRegistryTtlMs = 30000;
const { argv: cliArgv, noOpenBrowser } = stripGlobalFlags(process.argv.slice(2));
const cliInvocation = parseCliInvocation(cliArgv);
const requestedMarkdownArg = requestedDocumentPath();
let activeDocument = resolveActiveDocument(requestedMarkdownArg);

const defaultSettings = {
  version: 1,
  userName: "",
  toneOfVoice: "",
  toneOfVoiceSetupComplete: false,
  editorLanguage: "en-GB",
  documentFont: "default",
  theme: "default",
  agentRuntime: defaultConfiguredRuntime,
  agentModel: defaultConfiguredModel,
  agentEffort: defaultConfiguredEffort,
  defaultSkills: [],
  autoReplyToComments: true,
  showResolvedThreads: false,
  panelState: {
    leftCollapsed: false,
    rightCollapsed: false
  },
  proposalModeDefault: "conservative",
  diffViewMode: "split",
  updatedAt: new Date().toISOString()
};

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
  effort: defaultConfiguredEffort === "auto" ? null : defaultConfiguredEffort,
  configuredEffort: defaultConfiguredEffort,
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
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const subscribers = new Set();
const agentQueue = [];
const maxContextLedgerEvents = 240;
const maxImageAssetBytes = 12 * 1024 * 1024;
const imageMimeExtensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"]
]);
const falseProposalDisabledPattern =
  /\b(?:document proposals?\s+(?:are|is)\s+disabled|can't\s+(?:show|return|create)[^.]*\b(?:diff|proposal)[^.]*\b(?:mode|disabled)|can't\s+return\s+a\s+reviewable\s+full[- ]document\s+diff\s+in\s+this\s+mode)\b/i;
let checkpointTimer = null;
let documentMemory = null;
let settingsMemory = null;
let agentRunning = false;
let skillRegistryCache = null;
let skillRegistryCachedAt = 0;
let runtimeRegistryCache = null;
let runtimeRegistryCachedAt = 0;

async function ensureAppStorage() {
  await mkdir(appConfigDir, { recursive: true });
  if (resolve(dataDir) !== resolve(legacyDataDir) && !existsSync(dataDir) && existsSync(legacyDataDir)) {
    await mkdir(dirname(dataDir), { recursive: true });
    await cp(legacyDataDir, dataDir, { recursive: true, errorOnExist: false, force: false });
  }
  await mkdir(dataDir, { recursive: true });

  if (!existsSync(settingsPath)) {
    await writeFile(settingsPath, JSON.stringify(defaultSettings, null, 2), "utf8");
  }
}

function userWorkingDirectory() {
  return process.env.INIT_CWD || process.cwd();
}

function resolveUserPath(pathArg) {
  if (!pathArg) return pathArg;
  return resolve(userWorkingDirectory(), pathArg);
}

function stripGlobalFlags(argv) {
  const args = [...argv];
  let noOpenBrowser = false;
  const filtered = args.filter((arg) => {
    if (arg === "--no-open") {
      noOpenBrowser = true;
      return false;
    }
    return true;
  });
  return { argv: filtered, noOpenBrowser };
}

function assertExternalDocumentExists() {
  if (activeDocument.source !== "external") return;
  if (existsSync(activeDocument.markdownPath)) return;

  console.error(`Document not found: ${activeDocument.markdownPath}`);
  if (requestedMarkdownArg && !requestedMarkdownArg.startsWith("/")) {
    console.error(`Relative paths resolve from: ${userWorkingDirectory()}`);
  }
  process.exit(1);
}

async function ensureDocumentFiles() {
  await mkdir(activeDocument.docDir, { recursive: true });
  await mkdir(activeDocument.snapshotsDir, { recursive: true });
  await mkdir(activeDocument.assetsDir, { recursive: true });

  if (!existsSync(activeDocument.markdownPath)) {
    if (activeDocument.source === "external") {
      assertExternalDocumentExists();
    }
    await mkdir(dirname(activeDocument.markdownPath), { recursive: true });
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

function normalizeEditorLanguage(value) {
  return value === "en-US" || value === "en-GB" ? value : defaultSettings.editorLanguage;
}

function normalizeDocumentFont(value) {
  return ["default", "sans", "serif", "mono"].includes(value) ? value : defaultSettings.documentFont;
}

function normalizeAppTheme(value) {
  return ["default", "newsprint", "sage", "coral", "graphite"].includes(value) ? value : defaultSettings.theme;
}

function normalizeProposalMode(value) {
  return value === "bold" || value === "conservative" ? value : defaultSettings.proposalModeDefault;
}

function normalizeDiffViewMode(value) {
  return value === "unified" || value === "split" ? value : defaultSettings.diffViewMode;
}

function normalizeDefaultSkills(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((skillId) => String(skillId || "").trim())
        .filter((skillId) => /^[a-z0-9:_-]+$/i.test(skillId))
    )
  ).slice(0, 20);
}

function normalizePanelState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    leftCollapsed: typeof source.leftCollapsed === "boolean" ? source.leftCollapsed : defaultSettings.panelState.leftCollapsed,
    rightCollapsed:
      typeof source.rightCollapsed === "boolean" ? source.rightCollapsed : defaultSettings.panelState.rightCollapsed
  };
}

function normalizeAppSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const userName = typeof source.userName === "string" ? source.userName.slice(0, 120) : defaultSettings.userName;
  const toneOfVoice =
    typeof source.toneOfVoice === "string" ? source.toneOfVoice.slice(0, toneOfVoiceMaxChars) : defaultSettings.toneOfVoice;
  return {
    ...defaultSettings,
    ...source,
    version: 1,
    userName,
    toneOfVoice,
    toneOfVoiceSetupComplete:
      typeof source.toneOfVoiceSetupComplete === "boolean" ? source.toneOfVoiceSetupComplete : Boolean(toneOfVoice.trim()),
    editorLanguage: normalizeEditorLanguage(source.editorLanguage),
    documentFont: normalizeDocumentFont(source.documentFont),
    theme: normalizeAppTheme(source.theme),
    agentRuntime: normalizeConfiguredRuntime(source.agentRuntime ?? defaultSettings.agentRuntime),
    agentModel: normalizeConfiguredModel(source.agentModel ?? defaultSettings.agentModel),
    agentEffort: normalizeConfiguredEffort(source.agentEffort ?? defaultSettings.agentEffort),
    defaultSkills: normalizeDefaultSkills(source.defaultSkills),
    autoReplyToComments:
      typeof source.autoReplyToComments === "boolean"
        ? source.autoReplyToComments
        : defaultSettings.autoReplyToComments,
    showResolvedThreads:
      typeof source.showResolvedThreads === "boolean" ? source.showResolvedThreads : defaultSettings.showResolvedThreads,
    panelState: normalizePanelState(source.panelState),
    proposalModeDefault: normalizeProposalMode(source.proposalModeDefault),
    diffViewMode: normalizeDiffViewMode(source.diffViewMode),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : defaultSettings.updatedAt
  };
}

function getSettings() {
  if (!settingsMemory) settingsMemory = normalizeAppSettings(defaultSettings);
  return settingsMemory;
}

async function setSettings(nextSettings) {
  settingsMemory = normalizeAppSettings({
    ...getSettings(),
    ...(nextSettings && typeof nextSettings === "object" ? nextSettings : {}),
    updatedAt: nowIso()
  });
  await mkdir(appConfigDir, { recursive: true });
  await atomicWrite(settingsPath, JSON.stringify(settingsMemory, null, 2));
  return settingsMemory;
}

function normalizeConfiguredRuntime(value) {
  const runtime = String(value || "").trim().toLowerCase();
  return runtime || "auto";
}

function normalizeConfiguredModel(value) {
  const model = String(value || "").trim();
  return model || "auto";
}

function normalizeConfiguredEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  return effort || "auto";
}

function sessionConfiguredRuntime(session) {
  return normalizeConfiguredRuntime(session?.configuredRuntime || session?.runtime || defaultConfiguredRuntime);
}

function sessionConfiguredModel(session) {
  return normalizeConfiguredModel(session?.configuredModel || session?.model || defaultConfiguredModel);
}

function sessionConfiguredEffort(session) {
  return normalizeConfiguredEffort(session?.configuredEffort || session?.effort || defaultConfiguredEffort);
}

function normalizeAgentSession(session, { queueDepth = agentQueue.length } = {}) {
  const configuredRuntime = sessionConfiguredRuntime(session);
  const configuredModel = sessionConfiguredModel(session);
  const configuredEffort = sessionConfiguredEffort(session);
  const runtime = normalizeConfiguredRuntime(session?.runtime || (configuredRuntime === "auto" ? "auto" : configuredRuntime));

  return {
    ...defaultSession,
    ...(session && typeof session === "object" ? session : {}),
    id: activeDocument.id,
    runtime,
    configuredRuntime,
    model: configuredModel === "auto" ? null : configuredModel,
    configuredModel,
    effort: configuredEffort === "auto" ? null : configuredEffort,
    configuredEffort,
    queueDepth
  };
}

function sessionWithAgentSettings(session, settings = getSettings()) {
  return {
    ...(session && typeof session === "object" ? session : {}),
    configuredRuntime: settings.agentRuntime,
    runtime: settings.agentRuntime === "auto" ? "auto" : settings.agentRuntime,
    configuredModel: settings.agentModel,
    model: settings.agentModel === "auto" ? null : settings.agentModel,
    configuredEffort: settings.agentEffort,
    effort: settings.agentEffort === "auto" ? null : settings.agentEffort
  };
}

function requestedDocumentPath() {
  const envPath = process.env.SKRIBE_DOCUMENT || process.env.SKRIBE_DOCUMENT_PATH;
  if (envPath) return envPath;
  return cliInvocation.markdownPath;
}

function parseCliInvocation(argv) {
  const args = [...argv];
  const first = args[0] || "";
  const commandNames = new Set(["doctor", "runtimes", "skills", "config", "status", "export", "open"]);
  const flagCommands = new Map([
    ["--version", "version"],
    ["-v", "version"],
    ["--help", "help"],
    ["-h", "help"]
  ]);

  if (flagCommands.has(first)) {
    return { command: flagCommands.get(first), args: args.slice(1), markdownPath: null };
  }

  if (commandNames.has(first)) {
    const command = first;
    const rest = args.slice(1);
    return {
      command: command === "open" ? null : command,
      args: rest,
      markdownPath: firstNonOptionValue(rest, new Set(["--out", "-o"])) ?? null
    };
  }

  return {
    command: null,
    args,
    markdownPath: firstNonOptionValue(args) ?? null
  };
}

function firstNonOptionValue(args, valueTakingOptions = new Set()) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (valueTakingOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return arg;
  }
  return null;
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
  const assetDirectoryName = `${safeFileStem(basename(markdownPath, extname(markdownPath)) || "draft")}.assets`;
  const assetsDir = source === "internal" ? join(docDir, "assets") : join(dirname(markdownPath), assetDirectoryName);
  return {
    id,
    source,
    title,
    markdownPath,
    docDir,
    assetsDir,
    assetMarkdownPrefix: source === "internal" ? "assets" : assetDirectoryName,
    reviewPath: join(docDir, "review.json"),
    sessionPath: join(docDir, "session.json"),
    eventsPath: join(docDir, "events.jsonl"),
    snapshotsDir,
    revisionsPath: join(snapshotsDir, "revisions.json")
  };
}

function safeFileStem(value) {
  const stem = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return stem && !/^\.+$/.test(stem) ? stem : "asset";
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

  const markdownPath = resolveUserPath(markdownArg);
  return buildDocumentPaths({
    id: `file_${hashString(markdownPath)}`,
    source: "external",
    title: titleFromPath(markdownPath),
    markdownPath
  });
}

async function handOffToExistingServer(markdownArg) {
  const health = await requestExistingServer("/api/health");
  if (!isSkribeHealthResponse(health.payload)) return false;

  if (!markdownArg) {
    if (health.payload.markdownPath) console.log(`Document: ${health.payload.markdownPath}`);
    console.log(`Open Skribe in your browser: ${appUrl}`);
    return true;
  }

  const response = await requestExistingServer("/api/documents/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdownPath: activeDocument.markdownPath })
  });

  if (!response.ok) {
    const message = response.payload?.error || `Existing Skribe server could not open ${activeDocument.markdownPath}`;
    console.error(message);
    process.exitCode = 1;
    return true;
  }

  const document = response.payload?.document;
  console.log(`Opened: ${document?.fileInfo?.markdownPath || activeDocument.markdownPath}`);
  console.log(`Open Skribe in your browser: ${appUrl}`);
  return true;
}

async function requestExistingServer(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(`${appUrl}${path}`, {
      ...options,
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, payload: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function readPackageVersion() {
  const packageJson = await readJson(join(root, "package.json"), {});
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

function printCliHelp() {
  console.log(`Skribe - local-first Markdown writing with an AI review partner.

Usage:
  skribe [file.md]              Open a Markdown file, or the default local draft
  skribe open [file.md]         Same as skribe [file.md]
  skribe --version, -v          Print the installed version
  skribe --help, -h             Show this help

Diagnostics:
  skribe doctor                 Check storage, build assets, port, runtimes, and skills
  skribe runtimes               List detected agent CLI runtimes and models
  skribe skills                 List discovered local agent skills
  skribe config                 Print effective local paths and defaults
  skribe status                 Show the running local app status, if any

Utility:
  skribe export [file.md]       Print clean Markdown from a running app or file
  skribe export --out out.md    Write exported Markdown to a file

Options:
  --no-open                     Do not open the app URL in your browser on startup

Environment:
  PORT                          Local server port, default 4327
  SKRIBE_NO_OPEN_BROWSER=1      Do not open the app URL in your browser on startup
  SKRIBE_OPEN_BROWSER=1         Open the app URL even for direct node server/index.mjs runs
  SKRIBE_CLI_INVOCATION=1       Set by the skribe CLI wrapper; enables browser open on startup
  SKRIBE_CONFIG_DIR             Settings and local app state directory
  SKRIBE_DATA_DIR               Document sidecar and internal document data directory
  SKRIBE_AGENT_RUNTIME          auto, codex, claude, local, or stub
  SKRIBE_AGENT_RUNTIME_PRIORITY Runtime order for auto, default codex,claude,local
  SKRIBE_LOCAL_BASE_URL         OpenAI-compatible base URL for local inference
  SKRIBE_LOCAL_API_KEY          Optional bearer token for local inference servers
  SKRIBE_SKILL_ROOTS            Extra colon-separated skill directories`);
}

function shouldOpenBrowser() {
  if (noOpenBrowser) return false;
  if (process.env.SKRIBE_NO_OPEN_BROWSER === "1") return false;
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  if (process.env.npm_lifecycle_event === "test") return false;
  if (process.env.SKRIBE_OPEN_BROWSER === "1") return true;
  if (process.env.SKRIBE_CLI_INVOCATION === "1") return true;
  if (process.env.npm_lifecycle_event === "serve") return true;
  return false;
}

function openBrowser(url) {
  if (!shouldOpenBrowser()) return;

  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, { detached: true, stdio: "ignore" }, (error) => {
    if (error) {
      console.error(`Could not open browser automatically. Open ${url} manually.`);
    }
  });
}

function printStartupSummary() {
  console.log(`Document: ${activeDocument.markdownPath}`);
  console.log(`Review state: ${activeDocument.docDir}`);
  console.log(`Agent runtime: ${getDocument().agentSession.configuredRuntime}`);
  console.log(`Agent model: ${getDocument().agentSession.configuredModel}`);
  console.log("");
  console.log(`Open Skribe in your browser: ${appUrl}`);
}

function formatRuntimeStatus(runtime) {
  const availability = runtime.available ? "available" : "unavailable";
  const version = runtime.version ? ` ${runtime.version}` : "";
  const modelCount = runtime.models?.length ? `, ${runtime.models.length} model${runtime.models.length === 1 ? "" : "s"}` : "";
  const effortCount = runtime.effortLevels?.length
    ? `, ${runtime.effortLevels.length} effort level${runtime.effortLevels.length === 1 ? "" : "s"}`
    : "";
  return `${runtime.label} (${runtime.id}): ${availability}${version}${modelCount}${effortCount}`;
}

async function printRuntimeReport() {
  const config = await agentRuntimeConfigResponse();
  console.log(`Configured runtime: ${config.configuredRuntime}`);
  console.log(`Resolved runtime: ${config.resolvedRuntime || "none"}`);
  console.log(`Configured model: ${config.configuredModel}`);
  console.log(`Configured effort: ${config.configuredEffort}`);
  console.log("");
  for (const runtime of config.runtimes.filter((item) => item.id !== "stub")) {
    console.log(formatRuntimeStatus(runtime));
    for (const note of runtime.notes || []) console.log(`  - ${note}`);
    if (runtime.models?.length) {
      const models = runtime.models.slice(0, 12).map((model) => model.label || model.id).join(", ");
      const suffix = runtime.models.length > 12 ? `, +${runtime.models.length - 12} more` : "";
      console.log(`  models: ${models}${suffix}`);
    }
    if (runtime.effortLevels?.length) {
      console.log(`  effort: ${runtime.effortLevels.map((level) => level.label || level.id).join(", ")}`);
    }
  }
}

async function printSkillsReport() {
  const skills = await discoverAgentSkills();
  if (skills.length === 0) {
    console.log("No local skills discovered.");
    console.log(`Roots checked: ${defaultSkillRoots().join(delimiter)}`);
    return;
  }

  console.log(`${skills.length} skill${skills.length === 1 ? "" : "s"} discovered:`);
  for (const skill of skills) {
    console.log(`/${skill.id} (${skill.source})${skill.description ? ` - ${skill.description}` : ""}`);
  }
}

async function printConfigReport() {
  await ensureAppStorage();
  settingsMemory = normalizeAppSettings(await readJson(settingsPath, defaultSettings));
  const settings = getSettings();
  console.log(`Config dir: ${appConfigDir}`);
  console.log(`Data dir: ${dataDir}`);
  console.log(`Settings: ${settingsPath}`);
  console.log(`Default document: ${join(docsDir, defaultDocId, "draft.md")}`);
  console.log(`URL: ${appUrl}`);
  console.log(`Agent runtime: ${settings.agentRuntime}`);
  console.log(`Agent model: ${settings.agentModel}`);
  console.log(`Agent effort: ${settings.agentEffort}`);
  console.log(`Editor language: ${settings.editorLanguage}`);
  console.log(`Theme: ${settings.theme}`);
  console.log(`Document font: ${settings.documentFont}`);
}

async function printStatusReport() {
  const health = await requestExistingServer("/api/health");
  if (!health.ok || !isSkribeHealthResponse(health.payload)) {
    console.log(`Skribe is not running at ${appUrl}`);
    return;
  }

  console.log(`Skribe is running at ${appUrl}`);
  console.log(`Document: ${health.payload.markdownPath || "unknown"}`);
  console.log(`Agent status: ${health.payload.agentStatus || "unknown"}`);
  console.log(`Agent runtime: ${health.payload.runtime || health.payload.configuredRuntime || "unknown"}`);
  console.log(`Agent model: ${health.payload.model || health.payload.configuredModel || "default"}`);
}

async function printDoctorReport() {
  console.log(`Skribe ${await readPackageVersion()}`);
  console.log(`Node.js ${process.version}`);
  console.log("");
  await printConfigReport();
  console.log("");
  console.log(existsSync(distDir) ? "Build assets: present" : "Build assets: missing. Run npm run build.");
  const health = await requestExistingServer("/api/health");
  console.log(health.ok ? `Server: running at ${appUrl}` : `Server: not running at ${appUrl}`);
  console.log("");
  await printRuntimeReport();
  console.log("");
  const skills = await discoverAgentSkills();
  console.log(`Skills: ${skills.length} discovered`);
}

async function exportMarkdownFromCli(args) {
  const outIndex = args.findIndex((arg) => arg === "--out" || arg === "-o");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

  let markdown = "";
  const runningExport = await fetch(`${appUrl}/api/export.md`).then(
    async (response) => (response.ok ? await response.text() : null),
    () => null
  );

  if (runningExport !== null && !cliInvocation.markdownPath) {
    markdown = runningExport;
  } else if (cliInvocation.markdownPath) {
    const markdownPath = resolveUserPath(cliInvocation.markdownPath);
    markdown = await readFile(markdownPath, "utf8");
  } else {
    console.error(`No running Skribe server found at ${appUrl}, and no Markdown file was provided.`);
    process.exitCode = 1;
    return;
  }

  if (outPath) {
    const resolvedOutPath = resolveUserPath(outPath);
    await writeFile(resolvedOutPath, markdown, "utf8");
    console.log(`Exported Markdown to ${resolvedOutPath}`);
  } else {
    process.stdout.write(markdown);
  }
}

async function handleCliCommand() {
  switch (cliInvocation.command) {
    case "version":
      console.log(await readPackageVersion());
      return true;
    case "help":
      printCliHelp();
      return true;
    case "doctor":
      await printDoctorReport();
      return true;
    case "runtimes":
      await printRuntimeReport();
      return true;
    case "skills":
      await printSkillsReport();
      return true;
    case "config":
      await printConfigReport();
      return true;
    case "status":
      await printStatusReport();
      return true;
    case "export":
      await exportMarkdownFromCli(cliInvocation.args);
      return true;
    default:
      return false;
  }
}

function isSkribeHealthResponse(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      payload.ok === true &&
      (payload.app === "skribe" || (payload.storage === "memory-first" && typeof payload.markdownPath === "string"))
  );
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
    home ? join(home, ".claude", "skills") : null,
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
  if (path.includes("/.agents/skills/") || path.includes("/.claude/skills/") || path.includes("/.codex/skills/")) return "local";
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
        source: skillSourceForPath(skillPath),
        path: skillPath
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
  const configured = process.env.SKRIBE_AGENT_RUNTIME_PRIORITY || "codex,claude,local";
  return configured
    .split(",")
    .map((item) => normalizeConfiguredRuntime(item))
    .filter(Boolean);
}

const localInferenceProbeTimeoutMs = 2000;
const localSkillInlineMaxChars = 6000;
const localInferenceDefaultEndpoints = [
  { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
  { label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1" }
];

function normalizeLocalBaseUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function localInferenceApiKey() {
  return process.env.SKRIBE_LOCAL_API_KEY || "";
}

function localInferenceBaseUrlCandidates() {
  const configured = normalizeLocalBaseUrl(process.env.SKRIBE_LOCAL_BASE_URL);
  if (configured) return [{ label: "configured", baseUrl: configured }];
  return localInferenceDefaultEndpoints;
}

function localInferenceRequestHeaders(contentType = null) {
  const headers = { accept: "application/json" };
  if (contentType) headers["content-type"] = contentType;
  const apiKey = localInferenceApiKey();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

async function fetchLocalInferenceModels(baseUrl, timeoutMs = localInferenceProbeTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
      headers: localInferenceRequestHeaders()
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
    return rawModels
      .map((item) => {
        const id = String(item?.id || item?.name || "").trim();
        if (!id) return null;
        return { id, label: id, source: "endpoint" };
      })
      .filter(Boolean);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLocalInferenceEndpoint() {
  for (const candidate of localInferenceBaseUrlCandidates()) {
    const models = await fetchLocalInferenceModels(candidate.baseUrl);
    if (models !== null) {
      return {
        baseUrl: candidate.baseUrl,
        label: candidate.label,
        models
      };
    }
  }
  return null;
}

async function postLocalChatCompletion(baseUrl, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: localInferenceRequestHeaders("application/json"),
      body: JSON.stringify(body)
    });
    const responseText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        errorText: responseText.slice(0, 4000),
        content: ""
      };
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        status: response.status,
        errorText: "Invalid JSON response from local inference server.",
        content: ""
      };
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return {
        ok: false,
        status: response.status,
        errorText: "Local inference server returned an empty completion.",
        content: ""
      };
    }

    return { ok: true, status: response.status, content };
  } catch (error) {
    return {
      ok: false,
      status: null,
      errorText: error instanceof Error ? error.message : String(error),
      content: ""
    };
  } finally {
    clearTimeout(timer);
  }
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

function effortLabel(effort) {
  const labels = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    max: "Max"
  };
  return labels[effort] || effort;
}

function parseHelpEffortLevels(helpText) {
  const match = helpText.match(/--effort[\s\S]*?\(([^)]+)\)/i);
  if (!match) return [];

  return match[1]
    .split(/[,|/]\s*/)
    .map((value) => value.replace(/['"`().]/g, "").trim().toLowerCase())
    .filter(Boolean)
    .map((effort) => ({ id: effort, label: effortLabel(effort), source: "help" }));
}

function mergeEffortLevels(levelGroups) {
  const merged = [];
  for (const levels of levelGroups) {
    for (const level of levels || []) {
      if (!level?.id || merged.some((item) => item.id === level.id)) continue;
      merged.push(level);
    }
  }
  return merged;
}

function displayNameFromClaudeModelId(modelId) {
  const match = modelId.match(/^claude-([a-z]+)-(\d+)-(\d+)(?:-.+)?$/i);
  if (!match) return null;
  const family = `${match[1].slice(0, 1).toUpperCase()}${match[1].slice(1)}`;
  return `${family} ${match[2]}.${match[3]}`;
}

function enrichClaudeModels(models, helpText) {
  const fullNameExamples = Array.from(helpText.matchAll(/['"]?(claude-[a-z0-9:_-]+)['"]?/gi)).map((match) => match[1]);

  return models.map((model) => {
    const fullName = fullNameExamples.find((example) => example.includes(`-${model.id}-`));
    const displayName = fullName ? displayNameFromClaudeModelId(fullName) : null;
    return {
      ...model,
      label: displayName || `${model.id.slice(0, 1).toUpperCase()}${model.id.slice(1)}`,
      description: fullName || `alias: ${model.id}`,
      source: `alias: ${model.id}`
    };
  });
}

function parseCodexModelCatalog(catalogText) {
  try {
    const payload = JSON.parse(catalogText);
    const catalogModels = Array.isArray(payload.models) ? payload.models : [];
    const visibleModels = catalogModels
      .filter((model) => model?.slug && model.visibility !== "hide")
      .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999));
    const models = visibleModels.map((model) => ({
      id: model.slug,
      label: model.display_name || model.slug,
      description: model.description || model.slug,
      source: "catalog"
    }));
    const effortLevels = mergeEffortLevels(
      visibleModels.map((model) =>
        Array.isArray(model.supported_reasoning_levels)
          ? model.supported_reasoning_levels.map((level) => ({
              id: String(level.effort || "").trim().toLowerCase(),
              label: effortLabel(String(level.effort || "").trim().toLowerCase()),
              description: level.description || "",
              source: "catalog"
            }))
          : []
      )
    ).filter((level) => level.id);
    const defaultEffort =
      visibleModels.find((model) => model.slug === defaultConfiguredModel)?.default_reasoning_level ||
      visibleModels.find((model) => model.default_reasoning_level)?.default_reasoning_level ||
      null;

    return {
      models,
      effortLevels,
      defaultEffort
    };
  } catch {
    return {
      models: [],
      effortLevels: [],
      defaultEffort: null
    };
  }
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
      supportsEffort: false,
      effortLevels: [],
      defaultEffort: null,
      notes: [`${label} executable not found or not runnable.`]
    };
  }

  const helpResult = await runProcessNoThrow(command, ["--help"], "", 5000, { cwd: root });
  const helpText = `${helpResult.stdout || ""}\n${helpResult.stderr || ""}`;
  const version = `${versionResult.stdout || versionResult.stderr || ""}`.trim() || null;
  const supportsModelFlag = /\s--model(?:\s|,|$)|\s-m,\s*--model/.test(helpText);
  const effortLevels = parseHelpEffortLevels(helpText);

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
    supportsEffort: effortLevels.length > 0,
    effortLevels,
    defaultEffort: null,
    notes: supportsModelFlag
      ? ["CLI supports a model flag, but does not expose a reliable complete model list. Manual model ids are allowed."]
      : ["CLI does not appear to expose model selection."]
  };
}

async function detectCodexRuntime() {
  const status = await detectCommandRuntime({
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    modelPatterns: []
  });
  if (!status.available) return status;

  const catalogResult = await runProcessNoThrow("codex", ["debug", "models", "--bundled"], "", 5000, { cwd: root });
  if (catalogResult.error) return status;

  const catalog = parseCodexModelCatalog(catalogResult.stdout || catalogResult.stderr || "");
  if (catalog.models.length === 0 && catalog.effortLevels.length === 0) return status;

  return {
    ...status,
    models: catalog.models.length > 0 ? catalog.models : status.models,
    supportsEffort: catalog.effortLevels.length > 0,
    effortLevels: catalog.effortLevels,
    defaultEffort: catalog.defaultEffort,
    notes:
      catalog.models.length > 0
        ? ["Model list loaded from the bundled Codex model catalog."]
        : status.notes
  };
}

async function detectClaudeRuntime() {
  const status = await detectCommandRuntime({
    id: "claude",
    label: "Claude Code",
    command: "claude",
    modelPatterns: [/alias(?:es)?[^()]*\((?:e\.g\.\s*)?['"]?([a-z0-9:_-]+)['"]?\s+or\s+['"]?([a-z0-9:_-]+)['"]?\)/i]
  });
  if (!status.available) return status;

  const helpResult = await runProcessNoThrow("claude", ["--help"], "", 5000, { cwd: root });
  const helpText = `${helpResult.stdout || ""}\n${helpResult.stderr || ""}`;

  return {
    ...status,
    models: enrichClaudeModels(status.models, helpText)
  };
}

async function detectLocalRuntime() {
  const configuredBaseUrl = normalizeLocalBaseUrl(process.env.SKRIBE_LOCAL_BASE_URL);
  const endpoint = await resolveLocalInferenceEndpoint();
  if (!endpoint) {
    const notes = [
      "No local inference server detected. Start Ollama, LM Studio, or llama-server, or set SKRIBE_LOCAL_BASE_URL."
    ];
    if (configuredBaseUrl) notes.unshift(`Configured endpoint not reachable: ${configuredBaseUrl}`);
    return {
      id: "local",
      label: "Local inference",
      command: null,
      available: false,
      version: null,
      supportsModelFlag: true,
      supportsStructuredOutput: true,
      supportsManualModel: true,
      models: [],
      defaultModel: null,
      supportsEffort: false,
      effortLevels: [],
      defaultEffort: null,
      notes
    };
  }

  return {
    id: "local",
    label: "Local inference",
    command: null,
    available: true,
    version: endpoint.baseUrl,
    supportsModelFlag: true,
    supportsStructuredOutput: true,
    supportsManualModel: true,
    models: endpoint.models,
    defaultModel: endpoint.models[0]?.id ?? null,
    supportsEffort: false,
    effortLevels: [],
    defaultEffort: null,
    notes: [
      `OpenAI-compatible endpoint: ${endpoint.baseUrl}`,
      endpoint.models.length > 0
        ? `${endpoint.models.length} model${endpoint.models.length === 1 ? "" : "s"} available.`
        : "Endpoint reachable, but no models were listed."
    ]
  };
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
    supportsEffort: false,
    effortLevels: [],
    defaultEffort: null,
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
  },
  local: {
    id: "local",
    label: "Local inference",
    detect: detectLocalRuntime,
    run: runLocalAgent
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
        supportsEffort: false,
        effortLevels: [],
        defaultEffort: null,
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

function selectedEffortForSession(session) {
  const configuredEffort = sessionConfiguredEffort(session);
  return configuredEffort === "auto" ? null : configuredEffort;
}

async function validateAgentConfiguration({ configuredRuntime, configuredModel, configuredEffort }, { force = false } = {}) {
  if (configuredRuntime !== "auto" && !agentRuntimeAdapters[configuredRuntime]) {
    throw new Error(`Unknown agent runtime "${configuredRuntime}".`);
  }

  const runtimes = await detectAgentRuntimes({ force });
  const byId = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
  const selectedRuntime =
    configuredRuntime === "auto" ? runtimePriority().find((id) => byId.get(id)?.available) ?? null : configuredRuntime;
  const selectedStatus = selectedRuntime ? byId.get(selectedRuntime) : null;

  if (configuredRuntime !== "auto" && selectedStatus && !selectedStatus.available) {
    throw new Error(`${selectedStatus.label} is not available.`);
  }
  if (configuredModel !== "auto" && selectedStatus && !selectedStatus.supportsManualModel) {
    throw new Error(`${selectedStatus.label} does not support model selection.`);
  }
  if (configuredEffort !== "auto" && selectedStatus && !selectedStatus.supportsEffort) {
    throw new Error(`${selectedStatus.label} does not support effort selection.`);
  }
  if (
    configuredEffort !== "auto" &&
    selectedStatus?.effortLevels?.length > 0 &&
    !selectedStatus.effortLevels.some((level) => level.id === configuredEffort)
  ) {
    throw new Error(`${selectedStatus.label} does not support effort "${configuredEffort}".`);
  }

  return { runtimes, selectedRuntime, selectedStatus };
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
  const effort = selectedEffortForSession(session);
  if (effort && !status.supportsEffort) {
    throw new Error(`${status.label || runtimeId} does not support effort selection.`);
  }
  if (effort && status.effortLevels?.length > 0 && !status.effortLevels.some((level) => level.id === effort)) {
    throw new Error(`${status.label || runtimeId} does not support effort "${effort}".`);
  }

  return {
    adapter,
    status,
    configuredRuntime,
    configuredModel: sessionConfiguredModel(session),
    model,
    configuredEffort: sessionConfiguredEffort(session),
    effort
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
    configuredEffort: session.configuredEffort,
    resolvedEffort: session.configuredEffort === "auto" ? null : session.configuredEffort,
    runtimes
  };
}

async function loadDocumentIntoMemory() {
  await ensureAppStorage();
  settingsMemory = normalizeAppSettings(await readJson(settingsPath, defaultSettings));
  assertExternalDocumentExists();
  await ensureDocumentFiles();
  const [markdown, review, agentSession, draftStat, reviewStat] = await Promise.all([
    readFile(activeDocument.markdownPath, "utf8"),
    readJson(activeDocument.reviewPath, defaultReview),
    readJson(activeDocument.sessionPath, defaultSession),
    stat(activeDocument.markdownPath),
    stat(activeDocument.reviewPath)
  ]);

  const normalizedSession = normalizeAgentSession(sessionWithAgentSettings(agentSession));
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
      assetsDir: activeDocument.assetsDir,
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

async function openDocument(markdownArg) {
  if (agentRunning || agentQueue.length > 0 || getDocument().agentSession?.status === "running") {
    throw new Error("Cannot open another document while an agent turn is running.");
  }

  const nextDocument = resolveActiveDocument(markdownArg || null);
  if (nextDocument.id === activeDocument.id) {
    await flushPendingCheckpoint();
    return getDocument();
  }

  await flushPendingCheckpoint();
  activeDocument = nextDocument;
  documentMemory = null;
  await loadDocumentIntoMemory();
  broadcast("document", getDocument());
  await appendEvent({ type: "document:open", at: nowIso(), markdownPath: activeDocument.markdownPath });
  return getDocument();
}

async function flushPendingCheckpoint() {
  if (checkpointTimer) {
    clearTimeout(checkpointTimer);
    checkpointTimer = null;
  }
  await checkpoint();
}

function normalizeReview(review) {
  const requestedLanguage = review?.settings?.editorLanguage;
  const editorLanguage =
    requestedLanguage === "en-US" || requestedLanguage === "en-GB" ? requestedLanguage : getSettings().editorLanguage;

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

const toneArchetypes = {
  "direct-founder": {
    name: "Direct founder",
    profile:
      "Direct, founder-to-founder, plainspoken, no hype. Make the argument quickly, use concrete examples, keep sentences tight, and avoid performative certainty."
  },
  "technical-editorial": {
    name: "Technical editorial",
    profile:
      "Clear, analytical, and editorial. Explain the technical idea in plain language, connect examples to the wider market, and avoid jargon unless it earns its place."
  },
  "operator-memo": {
    name: "Operator memo",
    profile:
      "Practical, concise, and workmanlike. Lead with the decision or claim, spell out tradeoffs, use operational detail, and avoid decorative prose."
  },
  "warm-teacher": {
    name: "Warm teacher",
    profile:
      "Approachable, patient, and concrete. Use short explanations, useful examples, and a calm voice that helps the reader understand without talking down to them."
  },
  "sharp-critic": {
    name: "Sharp critic",
    profile:
      "Pointed, precise, and unsentimental. Name weak assumptions directly, support critiques with evidence, and keep the tone fair rather than snarky."
  },
  "narrative-builder": {
    name: "Narrative builder",
    profile:
      "Narrative, thoughtful, and grounded. Build from a concrete observation toward a larger thesis, keep transitions smooth, and avoid abstract throat-clearing."
  }
};

const toneInterviewQuestions = [
  "Who are you writing for?",
  "What should the reader come away with?",
  "What should the voice avoid?",
  "Paste a paragraph that sounds like you.",
  "How direct should the agent be when editing?"
];

function normalizeToneLanguage(value) {
  return value === "en-US" ? "en-US" : "en-GB";
}

function cleanToneSourceText(value, maxLength = 50000) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function stripHtmlToText(html) {
  return cleanToneSourceText(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
  );
}

function uniqueToneItems(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, maxItems);
}

function sentenceStats(text) {
  const sentences = String(text || "").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const words = String(text || "").match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return {
    sentenceCount: sentences.length,
    wordCount: words.length,
    averageSentenceLength: sentences.length ? Math.round(words.length / sentences.length) : 0,
    questionCount: (String(text || "").match(/\?/g) || []).length,
    firstPersonCount: (String(text || "").match(/\b(?:I|we|me|my|our|us)\b/gi) || []).length,
    secondPersonCount: (String(text || "").match(/\b(?:you|your|reader|readers)\b/gi) || []).length
  };
}

function toneStyleFromText(text) {
  const stats = sentenceStats(text);
  const lower = String(text || "").toLowerCase();
  const traits = [];
  const preferences = [];
  const avoids = [];

  if (stats.averageSentenceLength && stats.averageSentenceLength <= 15) {
    traits.push("short, punchy sentences");
    preferences.push("keep momentum with compact paragraphs");
  } else if (stats.averageSentenceLength >= 24) {
    traits.push("longer, essay-like sentences");
    preferences.push("allow developed arguments when the logic needs room");
  } else {
    traits.push("balanced sentence length");
    preferences.push("mix short claims with slightly longer explanation");
  }

  if (stats.questionCount >= Math.max(2, Math.round(stats.sentenceCount * 0.08))) {
    traits.push("rhetorical questions");
    preferences.push("use questions to move the argument forward");
  }

  if (stats.firstPersonCount > stats.secondPersonCount) {
    traits.push("first-person perspective");
    preferences.push("let personal judgment show when it clarifies the claim");
  } else if (stats.secondPersonCount > 0) {
    traits.push("reader-facing phrasing");
    preferences.push("speak directly to the reader without sounding salesy");
  }

  if (/\b(?:because|therefore|so|that is why|the point is|the trap is|the move is)\b/i.test(text)) {
    traits.push("argument-led structure");
    preferences.push("make causal links explicit");
  }

  if (/\b(?:API|SDK|developer|infrastructure|deploy|runtime|agent|model|workflow|platform)\b/i.test(text)) {
    traits.push("technical examples");
    preferences.push("ground abstract points in concrete product or developer examples");
  }

  if (/\b(?:amazing|game[- ]changer|revolutionary|magical|10x|insane|incredible)\b/i.test(lower)) {
    avoids.push("trim hype words unless the user explicitly asks for promotional copy");
  } else {
    avoids.push("avoid hype, filler, and corporate gloss");
  }

  if (!traits.includes("argument-led structure")) traits.push("plainspoken clarity");
  if (preferences.length < 3) preferences.push("prefer concrete nouns and active verbs");

  return {
    traits: traits.slice(0, 5),
    preferences: preferences.slice(0, 5),
    avoids: avoids.slice(0, 3)
  };
}

function composeToneProfile({ sourceText, interviewAnswers = [], editorLanguage = "en-GB" }) {
  const language = normalizeToneLanguage(editorLanguage);
  const sampleText = cleanToneSourceText([sourceText, ...interviewAnswers].filter(Boolean).join(" "));
  const style = toneStyleFromText(sampleText);
  const answers = interviewAnswers.map((answer) => cleanToneSourceText(answer, 500)).filter(Boolean);
  const audience = answers[0] ? `Write for ${answers[0].replace(/[.]+$/g, "")}.` : "";
  const outcome = answers[1] ? `The reader should come away with: ${answers[1].replace(/[.]+$/g, "")}.` : "";
  const avoid = answers[2] ? `Avoid: ${answers[2].replace(/[.]+$/g, "")}.` : style.avoids.join(" ");
  const exemplar = answers[3] ? `Style reference: ${answers[3].replace(/[.]+$/g, "")}.` : "";
  const editing = answers[4] ? `When editing: ${answers[4].replace(/[.]+$/g, "")}.` : "";
  const languageRule = language === "en-GB" ? "Use British English spelling." : "Use American English spelling.";
  const parts = [
    "Audience and effect:",
    audience,
    outcome,
    "Stance and evidence: be opinionated, claim-first, and evidence-led. Back advice with examples, numbers, mechanisms, or direct operating experience.",
    `Structure and flow: use problem -> reframe -> practical guidance. Open with a concrete claim or familiar idea, then challenge or sharpen it. Use direct headings and short signposts.`,
    `Sentence style: ${style.traits.join(", ")}. Mix short standalone sentences with compact explanatory paragraphs. Use fragments deliberately for emphasis.`,
    `Language and diction: ${style.preferences.join("; ")}. Use plain verbs, concrete nouns, and product/growth vocabulary when it helps.`,
    "Punctuation and rhythm: prefer full stops, short paragraphs, colons for frameworks, parentheses for compact clarifications, and spaced hyphens for asides. Avoid em dashes.",
    "Rhetorical devices: use rhetorical questions, repetition, labels, and light business-friendly metaphors when they clarify the argument.",
    exemplar,
    editing,
    avoid,
    "Avoid AI-ish contrast scaffolds like 'this is not X, it is Y' unless the user explicitly wrote that structure.",
    languageRule
  ].filter(Boolean);
  return clipText(parts.join(" "), toneOfVoiceMaxChars);
}

function extractUrlsFromText(value) {
  return Array.from(String(value || "").matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)).map((match) =>
    match[0].replace(/[.,;:!?]+$/g, "")
  );
}

function extractToneInterviewUrls(messages) {
  return uniqueToneItems(
    normalizeToneInterviewMessages(messages).flatMap((message) => extractUrlsFromText(message.body)),
    5
  );
}

function normalizeToneInterviewMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((message) => ({
      role: message?.role === "agent" ? "agent" : "human",
      body: cleanToneSourceText(message?.body, 2000)
    }))
    .filter((message) => message.body)
    .slice(-20);
}

function toneInterviewAnswers(messages) {
  return normalizeToneInterviewMessages(messages)
    .filter((message) => message.role === "human")
    .map((message) => message.body);
}

function nextToneInterviewQuestion(messages) {
  const answers = toneInterviewAnswers(messages);
  return toneInterviewQuestions[Math.min(answers.length, toneInterviewQuestions.length - 1)] || toneInterviewQuestions[0];
}

function buildToneInterviewPrompt({ messages, editorLanguage, currentTone, forceGenerate, sourceSamples = [] }) {
  const normalizedMessages = normalizeToneInterviewMessages(messages);
  const answers = toneInterviewAnswers(normalizedMessages);
  const shouldGenerate = Boolean(forceGenerate) || answers.length >= toneInterviewQuestions.length;
  const sourceText = cleanToneSourceText(sourceSamples.join("\n\n"), 18000);

  return `You are Skribe's tone-of-voice interviewer.

Conduct a short back-and-forth interview, then generate a reusable writing preference for Skribe's agent.

Rules:
- Do not edit files.
- Reply only as valid JSON. No Markdown fences.
- Ask these questions in order, one at a time:
${toneInterviewQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")}
- If not enough questions have been answered and forceGenerate is false, briefly acknowledge the latest answer if useful, then ask the next unanswered question.
- Do not ask all questions at once.
- If all questions have been answered, or forceGenerate is true, synthesize a complete toneOfVoice profile instead of asking another question.
- If the transcript includes URLs and Reference writing samples are available below, use those samples to infer sentence structure, paragraph cadence, diction, punctuation, rhetorical devices, and recurring quirks.
- The toneOfVoice should be an instruction string the writing agent can follow. Include these sections in prose: audience and desired effect; stance and evidence; structure and flow; sentence structure; paragraph style; diction and vocabulary; punctuation; rhetorical devices; figurative language; humour/personality; editing behaviour; avoidances; spelling convention.
- Be specific enough for another agent to imitate the voice. Include concrete style constraints such as target sentence length, use of fragments, preferred transitions, headings/lists, repeated frameworks, punctuation choices, and phrases or structures to avoid.
- Be concise, but do not truncate important constraints.
- Use ${editorLanguage === "en-US" ? "American English" : "British English"} spelling guidance.
- Preserve the user's actual preferences over generic archetypes.
- Avoid recommending generic writing advice unless it is grounded in the transcript or reference samples.

Output shape:
{
  "status": "asking" | "ready",
  "reply": "short interviewer response or completion note",
  "toneOfVoice": "empty unless status is ready"
}

Existing tone, if any:
${currentTone || "(none)"}

forceGenerate: ${shouldGenerate ? "true" : "false"}
nextQuestionToAskIfNotReady: ${shouldGenerate ? "(none)" : nextToneInterviewQuestion(normalizedMessages)}

Interview transcript:
${JSON.stringify(normalizedMessages, null, 2)}

Reference writing samples from linked content:
${sourceText || "(none)"}
`;
}

function normalizeToneInterviewOutput(output, { messages, editorLanguage, forceGenerate, sourceSamples = [], warnings = [] }) {
  const answers = toneInterviewAnswers(messages);
  const shouldGenerate = Boolean(forceGenerate) || answers.length >= toneInterviewQuestions.length;
  const reply = clipText(output?.reply || output?.chatReply || agentOutputText(output), 800);
  const toneOfVoice = cleanToneSourceText(output?.toneOfVoice, toneOfVoiceMaxChars);
  const status = output?.status === "ready" || toneOfVoice ? "ready" : "asking";

  if (status === "ready" && toneOfVoice) {
    return {
      status: "ready",
      reply: reply || "I have enough to build your tone of voice.",
      toneOfVoice,
      warnings
    };
  }

  if (shouldGenerate) {
    return {
      status: "ready",
      reply: reply || "I have enough to build your tone of voice.",
      toneOfVoice: composeToneProfile({ interviewAnswers: answers, sourceText: sourceSamples.join("\n\n"), editorLanguage }),
      warnings: [
        ...warnings,
        "The agent did not return a tone profile, so Skribe generated a fallback from the interview transcript."
      ]
    };
  }

  return {
    status: "asking",
    reply: reply || nextToneInterviewQuestion(messages),
    toneOfVoice: "",
    warnings: []
  };
}

function runStubToneInterview({ messages, editorLanguage, forceGenerate, sourceSamples = [], warnings = [] }) {
  const answers = toneInterviewAnswers(messages);
  if (forceGenerate || answers.length >= toneInterviewQuestions.length) {
    return {
      status: "ready",
      reply: "I have enough to build your tone of voice.",
      toneOfVoice: composeToneProfile({ interviewAnswers: answers, sourceText: sourceSamples.join("\n\n"), editorLanguage }),
      warnings
    };
  }

  return {
    status: "asking",
    reply: nextToneInterviewQuestion(messages),
    toneOfVoice: "",
    warnings: []
  };
}

async function runToneInterview(body) {
  const editorLanguage = normalizeToneLanguage(body?.editorLanguage);
  const messages = normalizeToneInterviewMessages(body?.messages);
  const forceGenerate = Boolean(body?.forceGenerate);
  const currentTone = cleanToneSourceText(body?.currentTone, toneOfVoiceMaxChars);
  const runtimeSelection = await resolveAgentRuntimeSelection(sessionWithAgentSettings(getDocument().agentSession, getSettings()));
  const shouldGenerate = forceGenerate || toneInterviewAnswers(messages).length >= toneInterviewQuestions.length;
  const warnings = [];
  const sourceSamples = shouldGenerate
    ? (await Promise.all(extractToneInterviewUrls(messages).map((url) => fetchToneSource(url, warnings)))).filter(
        (text) => text.length >= 80
      )
    : [];

  if (runtimeSelection.adapter.id === "stub") {
    return runStubToneInterview({ messages, editorLanguage, forceGenerate, sourceSamples, warnings });
  }

  const turn = {
    id: makeId("tone"),
    source: "chat",
    body: "Tone of voice interview",
    createdAt: nowIso(),
    skills: []
  };
  const output = await runtimeSelection.adapter.run({
    turn,
    prompt: buildToneInterviewPrompt({ messages, editorLanguage, currentTone, forceGenerate, sourceSamples }),
    model: runtimeSelection.model,
    effort: runtimeSelection.effort,
    timeoutMs: agentTimeoutMs
  });

  return normalizeToneInterviewOutput(output, { messages, editorLanguage, forceGenerate, sourceSamples, warnings });
}

async function fetchToneSource(url, warnings) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    warnings.push(`Skipped invalid URL: ${url}`);
    return "";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    warnings.push(`Skipped unsupported URL: ${parsed.href}`);
    return "";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(parsed.href, {
      signal: controller.signal,
      headers: {
        "user-agent": "Skribe tone setup/0.1"
      }
    });
    if (!response.ok) {
      warnings.push(`Could not read ${parsed.href}: HTTP ${response.status}`);
      return "";
    }
    const text = await response.text();
    return stripHtmlToText(text).slice(0, 30000);
  } catch (error) {
    warnings.push(`Could not read ${parsed.href}: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function generateToneOfVoice(body) {
  const mode = String(body?.mode || "").trim();
  const editorLanguage = normalizeToneLanguage(body?.editorLanguage);
  const warnings = [];

  if (mode === "manual") {
    const toneOfVoice = cleanToneSourceText(body?.manualText, toneOfVoiceMaxChars);
    if (!toneOfVoice) throw new Error("Add a tone of voice before saving.");
    return { toneOfVoice, sourceCount: 1, warnings };
  }

  if (mode === "archetype") {
    const archetype = toneArchetypes[String(body?.archetypeId || "")] ?? toneArchetypes["direct-founder"];
    const languageRule = editorLanguage === "en-GB" ? " Use British English spelling." : " Use American English spelling.";
    return {
      toneOfVoice: clipText(`${archetype.profile}${languageRule}`, toneOfVoiceMaxChars),
      sourceCount: 1,
      warnings
    };
  }

  if (mode === "interview") {
    const answers = uniqueToneItems(body?.interviewAnswers, 8).map((answer) => cleanToneSourceText(answer, 1200));
    if (answers.join(" ").length < 20) throw new Error("Answer at least one interview prompt before generating a tone.");
    return {
      toneOfVoice: composeToneProfile({ interviewAnswers: answers, editorLanguage }),
      sourceCount: answers.length,
      warnings
    };
  }

  if (mode === "links") {
    const urls = uniqueToneItems(body?.urls, 5);
    if (urls.length === 0) throw new Error("Add at least one URL.");
    const sources = (await Promise.all(urls.map((url) => fetchToneSource(url, warnings)))).filter((text) => text.length >= 80);
    if (sources.length === 0) throw new Error(warnings[0] || "Could not read enough writing from those links.");
    return {
      toneOfVoice: composeToneProfile({ sourceText: sources.join("\n\n"), editorLanguage }),
      sourceCount: sources.length,
      warnings
    };
  }

  throw new Error("Unsupported tone setup mode.");
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
    checkpointTimer = null;
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

function isRemoteOrDataAsset(src) {
  return /^(?:https?:|data:|blob:)/i.test(String(src || "").trim());
}

function imageContentTypeForPath(path) {
  const ext = extname(path).toLowerCase();
  return contentTypes[ext] && contentTypes[ext].startsWith("image/") ? contentTypes[ext] : null;
}

function normalizeUploadMimeType(type, filename) {
  const requestedType = String(type || "").toLowerCase();
  if (imageMimeExtensions.has(requestedType)) return requestedType;

  const ext = extname(String(filename || "")).toLowerCase();
  for (const [mimeType, extension] of imageMimeExtensions.entries()) {
    if (extension === ext || (ext === ".jpeg" && mimeType === "image/jpeg")) return mimeType;
  }
  return "";
}

function markdownImageLiteral({ alt, src }) {
  const safeAlt = String(alt || "").replace(/\]/g, "\\]");
  const safeSrc = /[\s)]/.test(src) ? `<${src}>` : src.replace(/\)/g, "%29");
  return `![${safeAlt}](${safeSrc})`;
}

async function saveImageAsset(body) {
  const filename = typeof body.filename === "string" ? body.filename : "image";
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const dataMatch = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  const mimeType = normalizeUploadMimeType(dataMatch?.[1] || body.type, filename);
  if (!mimeType || !imageMimeExtensions.has(mimeType)) {
    throw new Error("Unsupported image type.");
  }
  if (!dataMatch) throw new Error("Image upload must use a base64 data URL.");

  const buffer = Buffer.from(dataMatch[2], "base64");
  if (buffer.length === 0) throw new Error("Image file is empty.");
  if (buffer.length > maxImageAssetBytes) throw new Error("Image file is too large.");

  const extension = imageMimeExtensions.get(mimeType) || ".png";
  const stem = safeFileStem(basename(filename, extname(filename)) || "image");
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 10);
  const storedName = `${stem}-${hash}${extension}`;
  await mkdir(activeDocument.assetsDir, { recursive: true });
  await writeFile(join(activeDocument.assetsDir, storedName), buffer);

  const src = `${activeDocument.assetMarkdownPrefix}/${storedName}`;
  const alt = safeFileStem(basename(filename, extname(filename)) || "image").replace(/[-_]+/g, " ");
  return {
    filename: storedName,
    src,
    url: `/api/assets?src=${encodeURIComponent(src)}`,
    markdown: markdownImageLiteral({ alt, src }),
    contentType: mimeType,
    size: buffer.length
  };
}

function resolveImageAssetPath(src) {
  const raw = String(src || "").trim();
  if (!raw || isRemoteOrDataAsset(raw)) return null;
  const normalized = normalize(raw).replace(/^(\.\.[/\\])+/, "");
  if (normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized)) return null;
  const filePath = resolve(dirname(activeDocument.markdownPath), normalized);
  const contentType = imageContentTypeForPath(filePath);
  if (!contentType) return null;
  return { filePath, contentType };
}

function serveImageAsset(res, src) {
  const asset = resolveImageAssetPath(src);
  if (!asset || !existsSync(asset.filePath)) {
    sendJson(res, 404, { error: "Image asset not found." });
    return;
  }
  res.writeHead(200, {
    "content-type": asset.contentType,
    "cache-control": "no-store"
  });
  createReadStream(asset.filePath).pipe(res);
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

  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, {
      settings: getSettings(),
      storage: {
        configDir: appConfigDir,
        dataDir,
        settingsPath
      }
    });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/settings") {
    const body = await parseBody(req);
    const requestedSettings = normalizeAppSettings({
      ...getSettings(),
      ...(body.settings && typeof body.settings === "object" ? body.settings : body)
    });

    let selectedRuntime;
    try {
      selectedRuntime = (
        await validateAgentConfiguration(
          {
            configuredRuntime: requestedSettings.agentRuntime,
            configuredModel: requestedSettings.agentModel,
            configuredEffort: requestedSettings.agentEffort
          },
          { force: true }
        )
      ).selectedRuntime;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }

    const settings = await setSettings(requestedSettings);
    updateSession(
      {
        ...sessionWithAgentSettings(getDocument().agentSession, settings),
        runtime: selectedRuntime || settings.agentRuntime,
        lastError: null
      },
      "settings:update"
    );
    await checkpoint();

    sendJson(res, 200, {
      settings,
      storage: {
        configDir: appConfigDir,
        dataDir,
        settingsPath
      }
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/tone/generate") {
    const body = await parseBody(req);
    try {
      sendJson(res, 200, await generateToneOfVoice(body));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/tone/interview") {
    const body = await parseBody(req);
    try {
      sendJson(res, 200, await runToneInterview(body));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/document") {
    sendJson(res, 200, getDocument());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/assets") {
    const body = await parseBody(req);
    try {
      const asset = await saveImageAsset(body);
      await appendEvent({ type: "asset:image", at: nowIso(), src: asset.src, filename: asset.filename });
      sendJson(res, 201, asset);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/assets") {
    serveImageAsset(res, url.searchParams.get("src") || "");
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/documents/open") {
    const body = await parseBody(req);
    try {
      const document = await openDocument(typeof body.markdownPath === "string" && body.markdownPath.trim() ? body.markdownPath : null);
      sendJson(res, 200, {
        document,
        revisions: await getRevisionResponse()
      });
    } catch (error) {
      sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
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
    const configuredEffort = normalizeConfiguredEffort(body.effort);

    let selectedRuntime;
    try {
      selectedRuntime = (
        await validateAgentConfiguration({ configuredRuntime, configuredModel, configuredEffort }, { force: true })
      ).selectedRuntime;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }

    const settings = await setSettings({
      ...getSettings(),
      agentRuntime: configuredRuntime,
      agentModel: configuredModel,
      agentEffort: configuredEffort
    });

    updateSession(
      {
        ...sessionWithAgentSettings(getDocument().agentSession, settings),
        runtime: selectedRuntime || configuredRuntime,
        lastError: null
      },
      "agent:config"
    );
    await checkpoint();

    sendJson(res, 200, {
      document: getDocument(),
      config: await agentRuntimeConfigResponse(),
      settings: getSettings()
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
      app: "skribe",
      ok: true,
      storage: "memory-first",
      runtime: session.runtime,
      configuredRuntime: session.configuredRuntime,
      model: session.model,
      configuredModel: session.configuredModel,
      effort: session.effort,
      configuredEffort: session.configuredEffort,
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
          effort: runtimeSelection.effort,
          configuredEffort: runtimeSelection.configuredEffort,
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

function asksForDocumentProposal(turn, proposalModeDefault = getSettings().proposalModeDefault) {
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
  const focusedEditRequest = editVerb && /\b(this|selected|selection|paragraph|sentence|section|intro|opening|ending|summary|headline)\b/.test(body);
  const confirmationSignal = /\b(proceed|go ahead|do it|yes|confirm|confirmed|sounds good|looks good)\b/.test(body);

  return (
    (proposalModeDefault === "bold" && focusedEditRequest) ||
    (editVerb && (broadTarget || reviewArtifact)) ||
    explicitDiffRequest ||
    (reviewArtifact && latestAgentRequestedDocumentProposal()) ||
    (reviewArtifact && (confirmationSignal || broadTarget)) ||
    confirmsPendingDocumentProposal(body)
  );
}

function inferTurnIntent(turn) {
  const proposalModeDefault = getSettings().proposalModeDefault;
  if (isSkillOnlyTurn(turn)) return "skill_pass";
  if (asksForDocumentProposal(turn, proposalModeDefault)) {
    return turn.source === "thread" ? "thread_document_proposal" : "document_proposal";
  }
  if (turn.source === "thread") return "anchored_thread";
  return "chat";
}

function buildResponsePolicy(turn) {
  const intent = inferTurnIntent(turn);
  const isSkillPass = intent === "skill_pass";
  const allowDocumentProposals = intent === "document_proposal" || intent === "thread_document_proposal" || isSkillPass;
  return {
    intent,
    proposalModeDefault: getSettings().proposalModeDefault,
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

function markdownForAgentTurn(turn, runtimeId = null) {
  const doc = getDocument();
  const policy = buildResponsePolicy(turn);
  const defaultMax = runtimeId === "local" ? 16000 : 24000;
  const maxChars = Number(process.env.SKRIBE_AGENT_MARKDOWN_MAX_CHARS || defaultMax);
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
  const settings = getSettings();
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
      editorLanguage: settings.editorLanguage,
      updatedAt: review.updatedAt
    },
    writingPreferences: {
      userName: settings.userName,
      toneOfVoice: settings.toneOfVoice,
      editorLanguage: settings.editorLanguage
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

async function loadInlinedSkillInstructions(selectedSkills) {
  if (!Array.isArray(selectedSkills) || selectedSkills.length === 0) return "";

  const registry = await discoverAgentSkills();
  const byId = new Map(registry.map((skill) => [skill.id, skill]));
  const sections = [];

  for (const skill of selectedSkills) {
    const registered = byId.get(skill.id);
    if (!registered?.path) continue;
    try {
      const markdown = await readFile(registered.path, "utf8");
      sections.push(`### Skill: ${registered.name || skill.id}\n${clipText(markdown, localSkillInlineMaxChars)}`);
    } catch {
      // Ignore unreadable skills; inlining is best-effort.
    }
  }

  if (sections.length === 0) return "";
  return `\nRequested skill instructions:\n${sections.join("\n\n")}\n`;
}

async function buildAgentPrompt(turn, runtimeSelection = null) {
  const contextPacket = buildAgentContextPacket(turn);
  const runtimeId = runtimeSelection?.status?.id ?? runtimeSelection?.adapter?.id ?? null;
  const currentMarkdown = markdownForAgentTurn(turn, runtimeId);
  const proposalModeInstruction = buildProposalModeInstruction(contextPacket.responsePolicy);
  const isLocalRuntime = runtimeId === "local";
  const inlinedSkills = isLocalRuntime ? await loadInlinedSkillInstructions(turn.skills) : "";
  const skillRules = isLocalRuntime
    ? [
        "- Follow the requested skill instructions included below before producing the JSON response.",
        "- Apply skill guidance to your answer; do not paste long skill instructions back into Skribe."
      ]
    : [
        "- You have access to the configured agent runtime's local skills. If requestedSkills is non-empty, load and follow those skills before producing the JSON response.",
        "- If the human names a skill in the message, or a skill clearly fits the writing task, use the runtime's skill mechanism when available.",
        "- Apply skill guidance to your answer; do not paste long skill instructions back into Skribe."
      ];

  return `You are Skribe's local writing partner for one Markdown document.

${proposalModeInstruction}

Rules:
- Do not edit files.
- Reply only as valid JSON. No Markdown fences.
- Be concise and specific.
${skillRules.map((rule) => `\n${rule}`).join("")}
- Respect document.editorLanguage for spelling conventions in replies and proposed edits.
- Respect writingPreferences.toneOfVoice as the default style for replies and proposed edits. Current user instructions, requested skills, and anchored comment context override the global tone when they conflict.
- Follow responsePolicy exactly.
- If responsePolicy.proposalModeDefault is "conservative", ask before broad rewrites unless responsePolicy.allowDocumentProposals is true. If it is "bold", prefer reviewable documentProposals for edit requests that imply changing the draft.
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
${inlinedSkills}
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
    prompt: await buildAgentPrompt(turn, runtimeSelection),
    model: runtimeSelection.model,
    effort: runtimeSelection.effort,
    timeoutMs: agentTimeoutMs
  });
}

async function runCodexAgent({ turn, prompt, model, effort, timeoutMs }) {
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
  if (effort) args.splice(1, 0, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`);

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

async function runClaudeAgent({ prompt, model, effort, timeoutMs }) {
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
  if (effort) args.push("--effort", effort);

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

async function runLocalAgent({ prompt, model, timeoutMs }) {
  const endpoint = await resolveLocalInferenceEndpoint();
  if (!endpoint) {
    throw new Error(
      "Local inference server is not available. Start Ollama, LM Studio, or llama-server, or set SKRIBE_LOCAL_BASE_URL."
    );
  }

  const resolvedModel = model || endpoint.models[0]?.id;
  if (!resolvedModel) {
    throw new Error(`No model available at ${endpoint.baseUrl}. Pull or load a model first.`);
  }

  const requestBody = {
    model: resolvedModel,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    stream: false,
    response_format: { type: "json_object" }
  };

  await appendEvent({
    type: "agent:spawn",
    at: nowIso(),
    args: ["local", `${endpoint.baseUrl}/chat/completions`, resolvedModel]
  });

  let result = await postLocalChatCompletion(endpoint.baseUrl, requestBody, timeoutMs);
  if (!result.ok && result.status === 400 && requestBody.response_format) {
    const retryBody = { ...requestBody };
    delete retryBody.response_format;
    result = await postLocalChatCompletion(endpoint.baseUrl, retryBody, timeoutMs);
  }

  if (!result.ok) {
    throw new Error(result.errorText || "Local inference request failed.");
  }

  await appendEvent({
    type: "agent:raw-output",
    at: nowIso(),
    stdout: result.content.slice(-4000),
    stderr: "",
    finalText: result.content.slice(-4000)
  });

  return parseAgentOutput(result.content);
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
  const relativeFilePath = relative(distDir, filePath).replaceAll("\\", "/");
  const isFingerprintedAsset = relativeFilePath.startsWith("assets/");
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" || !isFingerprintedAsset ? "no-store" : "public, max-age=31536000, immutable"
  });
  createReadStream(filePath).pipe(res);
}

function createAppServer() {
  return createServer(async (req, res) => {
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
  });
}

async function startServer() {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

if (await handleCliCommand()) {
  process.exit(process.exitCode ?? 0);
}

if (await handOffToExistingServer(requestedMarkdownArg)) {
  process.exit(process.exitCode ?? 0);
}

await loadDocumentIntoMemory();

try {
  await startServer();
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    if (await handOffToExistingServer(requestedMarkdownArg)) {
      process.exit(process.exitCode ?? 0);
    }
    console.error(`Skribe could not start because ${appUrl} is already in use by another process.`);
    console.error("Stop that process, or start Skribe with a different PORT value.");
    process.exit(1);
  }
  throw error;
}

console.log("Skribe is running.");
printStartupSummary();
openBrowser(appUrl);
