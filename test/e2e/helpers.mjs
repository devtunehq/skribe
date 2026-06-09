import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;

function chromiumPath() {
  const result = spawnSync("sh", ["-lc", "command -v chromium || command -v chromium-browser || command -v google-chrome"], {
    encoding: "utf8"
  });
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : "";
}

function randomPort() {
  return 47000 + Math.floor(Math.random() * 1000);
}

async function waitForHttpJson(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json();
  return { response, payload };
}

export async function removeTempDir(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

export async function makeMarkdownDoc(name, markdown) {
  const rootDir = await mkdtemp(join(tmpdir(), "skribe-e2e-doc-"));
  const markdownPath = join(rootDir, name);
  await writeFile(markdownPath, markdown, "utf8");
  return { rootDir, markdownPath };
}

export async function startSkribeServer(markdownPath, options = {}) {
  const configDir = await mkdtemp(join(tmpdir(), "skribe-e2e-config-"));
  const dataDir = await mkdtemp(join(tmpdir(), "skribe-e2e-data-"));
  const port = options.port ?? randomPort();
  const child = spawn("node", ["server/index.mjs", markdownPath], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SKRIBE_CONFIG_DIR: configDir,
      SKRIBE_DATA_DIR: dataDir,
      SKRIBE_AGENT_RUNTIME: "stub",
      SKRIBE_AGENT_MODEL: "auto",
      SKRIBE_AGENT_EFFORT: "auto",
      ...(options.env ?? {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttpJson(`${baseUrl}/api/health`);

  return {
    baseUrl,
    child,
    configDir,
    dataDir,
    output,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1500))]);
      }
      await removeTempDir(configDir);
      await removeTempDir(dataDir);
    }
  };
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
        return;
      }
      if (message.method && this.events.has(message.method)) {
        for (const handler of this.events.get(message.method)) handler(message.params || {});
      }
    };
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (event) => reject(event.error || new Error("WebSocket error"));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.events.set(method, (this.events.get(method) || []).filter((item) => item !== handler));
        resolve(params);
      };
      this.events.set(method, [...(this.events.get(method) || []), handler]);
    });
  }

  close() {
    this.ws.close();
  }
}

async function startBrowser() {
  const executable = chromiumPath();
  if (!executable) return null;

  const userDataDir = await mkdtemp(join(tmpdir(), "skribe-e2e-browser-"));
  const debugPort = randomPort();
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1440,1000",
      "--noerrdialogs",
      "--no-first-run",
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    { stdio: ["ignore", "ignore", "ignore"] }
  );

  const targetsUrl = `http://127.0.0.1:${debugPort}/json/list`;
  const targets = await waitForHttpJson(targetsUrl);
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("No browser page target available");

  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.waitOpen();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Input.setIgnoreInputEvents", { ignore: false });

  return {
    cdp,
    async stop() {
      cdp.close();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1500))]);
      }
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      await removeTempDir(userDataDir);
    }
  };
}

export async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime exception");
  return result.result?.value;
}

export async function waitFor(cdp, expression, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

export async function waitForFileText(path, pattern, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await readFile(path, "utf8");
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return readFile(path, "utf8");
}

export async function waitForFilePredicate(path, predicate, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await readFile(path, "utf8");
    if (predicate(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return readFile(path, "utf8");
}

export async function navigate(cdp, url, width = 1440, height = 1000) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  await evaluate(cdp, "document.fonts ? document.fonts.ready.then(() => true) : true");
  await waitFor(cdp, "Boolean(document.querySelector('.app-shell') && document.querySelector('.markdown-canvas'))");
}

export async function disableToneSetup(baseUrl) {
  const current = await jsonRequest(baseUrl, "/api/settings");
  const settings = {
    ...current.payload.settings,
    toneOfVoiceSetupComplete: true
  };
  const saved = await jsonRequest(baseUrl, "/api/settings", {
    method: "PUT",
    body: JSON.stringify({ settings })
  });
  if (!saved.response.ok) throw new Error(`Unable to disable tone setup: ${saved.response.status}`);
  return saved.payload.settings;
}

export async function seedReview(baseUrl, patch) {
  const current = await jsonRequest(baseUrl, "/api/document");
  const document = current.payload;
  const nextReview = {
    ...document.review,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  const saved = await jsonRequest(baseUrl, "/api/document", {
    method: "PUT",
    body: JSON.stringify({
      markdown: document.markdown,
      review: nextReview
    })
  });
  if (!saved.response.ok) throw new Error(`Unable to seed review: ${saved.response.status}`);
  return saved.payload;
}

export async function press(cdp, key, options = {}) {
  const modifiers = (options.ctrlKey ? 2 : 0) | (options.altKey ? 1 : 0) | (options.metaKey ? 4 : 0) | (options.shiftKey ? 8 : 0);
  const base = {
    key,
    code: options.code ?? key,
    windowsVirtualKeyCode: options.keyCode ?? key.toUpperCase().charCodeAt(0),
    nativeVirtualKeyCode: options.keyCode ?? key.toUpperCase().charCodeAt(0),
    modifiers
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

export async function insertText(cdp, text) {
  await cdp.send("Input.insertText", { text });
}

export async function mouseClick(cdp, point) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1
  });
}

export async function mouseDrag(cdp, from, to) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x, y: to.y, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
}

export async function browserTest(t) {
  const browser = await startBrowser();
  if (!browser) {
    t.skip("Chromium is not available");
    return null;
  }
  return browser;
}
