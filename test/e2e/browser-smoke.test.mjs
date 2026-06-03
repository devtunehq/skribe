import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

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

async function removeTempDir(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

async function startSkribeServer(markdownPath) {
  const configDir = await mkdtemp(join(tmpdir(), "skribe-e2e-config-"));
  const dataDir = await mkdtemp(join(tmpdir(), "skribe-e2e-data-"));
  const port = randomPort();
  const child = spawn("node", ["server/index.mjs", markdownPath], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SKRIBE_CONFIG_DIR: configDir,
      SKRIBE_DATA_DIR: dataDir,
      SKRIBE_AGENT_RUNTIME: "stub",
      SKRIBE_AGENT_MODEL: "auto",
      SKRIBE_AGENT_EFFORT: "auto"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttpJson(`${baseUrl}/api/health`);

  return {
    baseUrl,
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime exception");
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for browser expression: ${expression}`);
}

async function waitForFileText(path, pattern, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const text = await readFile(path, "utf8");
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return readFile(path, "utf8");
}

async function navigate(cdp, url, width = 1440, height = 1000) {
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

test("browser editor smoke: empty document can be typed, autosaved, and reloaded", async (t) => {
  const browser = await startBrowser();
  if (!browser) {
    t.skip("Chromium is not available");
    return;
  }

  const rootDir = await mkdtemp(join(tmpdir(), "skribe-e2e-doc-"));
  const markdownPath = join(rootDir, "empty.md");
  await writeFile(markdownPath, "", "utf8");
  const server = await startSkribeServer(markdownPath);

  try {
    await navigate(browser.cdp, server.baseUrl);
    await waitFor(browser.cdp, "Boolean(document.querySelector('.editable-text'))");
    await evaluate(
      browser.cdp,
      `(() => {
        const editable = document.querySelector('.editable-text');
        editable.focus();
        editable.textContent = 'Hello from browser test.';
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Hello from browser test.' }));
        return editable.textContent;
      })()`
    );
    await waitFor(
      browser.cdp,
      "fetch('/api/document').then((response) => response.json()).then((doc) => doc.markdown.includes('Hello from browser test.'))",
      5000
    );

    assert.match(await waitForFileText(markdownPath, /Hello from browser test\./), /Hello from browser test\./);

    await navigate(browser.cdp, `${server.baseUrl}/?reload=${Date.now()}`);
    assert.equal(
      await evaluate(browser.cdp, "document.querySelector('.editable-text')?.textContent.includes('Hello from browser test.')"),
      true
    );
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
});

test("browser responsive smoke: compact header has no title input or horizontal overflow", async (t) => {
  const browser = await startBrowser();
  if (!browser) {
    t.skip("Chromium is not available");
    return;
  }

  const rootDir = await mkdtemp(join(tmpdir(), "skribe-e2e-doc-"));
  const markdownPath = join(rootDir, "draft.md");
  await writeFile(markdownPath, "# Draft\n\nA short paragraph.\n", "utf8");
  const server = await startSkribeServer(markdownPath);

  try {
    await navigate(browser.cdp, server.baseUrl, 742, 1000);
    const metrics = await evaluate(
      browser.cdp,
      `(() => ({
        hasTitleInput: Boolean(document.querySelector('.title-input')),
        viewport: innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        topbarHeight: Math.round(document.querySelector('.topbar')?.getBoundingClientRect().height || 0)
      }))()`
    );

    assert.equal(metrics.hasTitleInput, false);
    assert.ok(metrics.documentScrollWidth <= metrics.viewport, JSON.stringify(metrics));
    assert.ok(metrics.bodyScrollWidth <= metrics.viewport, JSON.stringify(metrics));
    assert.ok(metrics.topbarHeight <= 80, JSON.stringify(metrics));
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
});
