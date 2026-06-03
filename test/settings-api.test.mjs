import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

async function waitForServer(baseUrl, process, timeoutMs = 8000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (process.exitCode !== null) {
      throw new Error(`server exited before startup with code ${process.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  throw new Error(`server did not start: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function startServer() {
  const configDir = await mkdtemp(join(tmpdir(), "skribe-config-"));
  const dataDir = await mkdtemp(join(tmpdir(), "skribe-data-"));
  const port = 46000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("node", ["server/index.mjs"], {
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

  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  await waitForServer(baseUrl, child);

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
      await rm(configDir, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function jsonRequest(baseUrl, path, options = {}) {
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

test("settings API persists all global settings to the config directory", async () => {
  const server = await startServer();
  try {
    const initial = await jsonRequest(server.baseUrl, "/api/settings");
    assert.equal(initial.response.status, 200);
    assert.equal(initial.payload.storage.configDir, server.configDir);
    assert.equal(initial.payload.storage.dataDir, server.dataDir);
    assert.equal(initial.payload.settings.editorLanguage, "en-GB");
    assert.equal(initial.payload.settings.agentRuntime, "stub");
    assert.equal(initial.payload.settings.toneOfVoiceSetupComplete, false);

    const longTone =
      `Write for startup founders and the product, growth, growth-marketing and dev-rel people who work alongside them. ` +
      `${"Be concrete, decisive, evidence-led, and grounded in operating experience. ".repeat(28)}` +
      "Preserve the author's voice.";
    const nextSettings = {
      ...initial.payload.settings,
      toneOfVoice: longTone,
      toneOfVoiceSetupComplete: true,
      editorLanguage: "en-US",
      agentRuntime: "stub",
      agentModel: "auto",
      agentEffort: "auto",
      defaultSkills: ["humanizer", "plgeek-voice", "humanizer"],
      autoReplyToComments: false,
      showResolvedThreads: true,
      panelState: {
        leftCollapsed: true,
        rightCollapsed: true
      },
      proposalModeDefault: "bold"
    };

    const saved = await jsonRequest(server.baseUrl, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ settings: nextSettings })
    });

    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.settings.toneOfVoice, nextSettings.toneOfVoice);
    assert.ok(saved.payload.settings.toneOfVoice.length > 1200);
    assert.ok(saved.payload.settings.toneOfVoice.endsWith("Preserve the author's voice."));
    assert.equal(saved.payload.settings.toneOfVoiceSetupComplete, true);
    assert.equal(saved.payload.settings.editorLanguage, "en-US");
    assert.equal(saved.payload.settings.agentRuntime, "stub");
    assert.equal(saved.payload.settings.agentModel, "auto");
    assert.equal(saved.payload.settings.agentEffort, "auto");
    assert.deepEqual(saved.payload.settings.defaultSkills, ["humanizer", "plgeek-voice"]);
    assert.equal(saved.payload.settings.autoReplyToComments, false);
    assert.equal(saved.payload.settings.showResolvedThreads, true);
    assert.deepEqual(saved.payload.settings.panelState, { leftCollapsed: true, rightCollapsed: true });
    assert.equal(saved.payload.settings.proposalModeDefault, "bold");

    const settingsFile = JSON.parse(await readFile(join(server.configDir, "settings.json"), "utf8"));
    assert.equal(settingsFile.toneOfVoice, longTone);
    assert.deepEqual(settingsFile.defaultSkills, ["humanizer", "plgeek-voice"]);
    assert.equal(settingsFile.toneOfVoiceSetupComplete, true);
    assert.equal(settingsFile.proposalModeDefault, "bold");

    const health = await jsonRequest(server.baseUrl, "/api/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.configuredRuntime, "stub");
    assert.match(health.payload.markdownPath, new RegExp(server.dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await server.stop();
  }
});

test("tone generator preserves long manual profiles above the old 1200 character cap", async () => {
  const server = await startServer();
  try {
    const longTone =
      `Write for startup founders and the product, growth, growth-marketing and dev-rel people who work alongside them. ` +
      `${"Make the advice concrete, useful, opinionated, and grounded in real operating examples. ".repeat(30)}` +
      "Preserve the author's voice.";
    assert.ok(longTone.length > 1200);

    const generated = await jsonRequest(server.baseUrl, "/api/tone/generate", {
      method: "POST",
      body: JSON.stringify({
        mode: "manual",
        manualText: longTone
      })
    });

    assert.equal(generated.response.status, 200);
    assert.equal(generated.payload.toneOfVoice, longTone);
    assert.ok(generated.payload.toneOfVoice.endsWith("Preserve the author's voice."));
  } finally {
    await server.stop();
  }
});

test("tone generator supports interview, archetype, and link inputs", async () => {
  const server = await startServer();
  const sourceServer = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`
      <article>
        <h1>Developer infrastructure memo</h1>
        <p>We write for developers who care about APIs, runtimes, platforms, and agent workflows.</p>
        <p>The voice is direct and practical because the reader needs an argument, not a launch slogan.</p>
        <p>Good developer tools make tradeoffs visible, explain why the workflow matters, and avoid hype.</p>
      </article>
    `);
  });

  try {
    await new Promise((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
    const sourceAddress = sourceServer.address();
    const sourceUrl = `http://127.0.0.1:${sourceAddress.port}/sample`;

    const interview = await jsonRequest(server.baseUrl, "/api/tone/generate", {
      method: "POST",
      body: JSON.stringify({
        mode: "interview",
        editorLanguage: "en-GB",
        interviewAnswers: [
          "technical founders and developer tool operators",
          "a concrete point of view they can use",
          "hype, corporate gloss, and vague claims"
        ]
      })
    });

    assert.equal(interview.response.status, 200);
    assert.equal(interview.payload.sourceCount, 3);
    assert.match(interview.payload.toneOfVoice, /Use British English spelling/);
    assert.match(interview.payload.toneOfVoice, /technical founders/);

    const archetype = await jsonRequest(server.baseUrl, "/api/tone/generate", {
      method: "POST",
      body: JSON.stringify({
        mode: "archetype",
        archetypeId: "sharp-critic",
        editorLanguage: "en-US"
      })
    });

    assert.equal(archetype.response.status, 200);
    assert.match(archetype.payload.toneOfVoice, /Pointed, precise/);
    assert.match(archetype.payload.toneOfVoice, /American English/);

    const links = await jsonRequest(server.baseUrl, "/api/tone/generate", {
      method: "POST",
      body: JSON.stringify({
        mode: "links",
        editorLanguage: "en-GB",
        urls: [sourceUrl]
      })
    });

    assert.equal(links.response.status, 200);
    assert.equal(links.payload.sourceCount, 1);
    assert.match(links.payload.toneOfVoice, /technical examples|developer examples/);
  } finally {
    sourceServer.close();
    await server.stop();
  }
});

test("tone interview endpoint runs a turn-by-turn agent conversation", async () => {
  const server = await startServer();
  const sourceServer = createHttpServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`
      <article>
        <h1>Win or learn</h1>
        <p>'Win or learn' is a common phrase in growth. But it's harmful.</p>
        <p>Take winning out. Take failing out. Do something. Learn.</p>
        <p>Repeatability. Predictability.</p>
        <p>WHAT: Developers. WHO: Growth teams. WHY: To make the loop useful.</p>
        <p>Can you prove that? Would it be useful to prove that?</p>
      </article>
    `);
  });

  try {
    await new Promise((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
    const sourceAddress = sourceServer.address();
    const sourceUrl = `http://127.0.0.1:${sourceAddress.port}/sample`;

    const firstTurn = await jsonRequest(server.baseUrl, "/api/tone/interview", {
      method: "POST",
      body: JSON.stringify({
        editorLanguage: "en-GB",
        messages: []
      })
    });

    assert.equal(firstTurn.response.status, 200);
    assert.equal(firstTurn.payload.status, "asking");
    assert.match(firstTurn.payload.reply, /Who are you writing for/);
    assert.equal(firstTurn.payload.toneOfVoice, "");

    const finalTurn = await jsonRequest(server.baseUrl, "/api/tone/interview", {
      method: "POST",
      body: JSON.stringify({
        editorLanguage: "en-GB",
        messages: [
          { role: "agent", body: firstTurn.payload.reply },
          { role: "human", body: "developer tool founders and operators" },
          { role: "agent", body: "What should the reader come away with?" },
          { role: "human", body: "a sharper practical point of view" },
          { role: "agent", body: "What should the voice avoid?" },
          { role: "human", body: "hype and vague claims" },
          { role: "agent", body: "Paste a paragraph that sounds like you." },
          { role: "human", body: `Can I link a few articles instead? ${sourceUrl}` },
          { role: "agent", body: "How direct should the agent be when editing?" },
          { role: "human", body: "Direct, but never smug." }
        ]
      })
    });

    assert.equal(finalTurn.response.status, 200);
    assert.equal(finalTurn.payload.status, "ready");
    assert.match(finalTurn.payload.toneOfVoice, /developer tool founders/);
    assert.match(finalTurn.payload.toneOfVoice, /Sentence style/);
    assert.match(finalTurn.payload.toneOfVoice, /Punctuation and rhythm/);
    assert.match(finalTurn.payload.toneOfVoice, /Rhetorical devices/);
    assert.match(finalTurn.payload.toneOfVoice, /British English/);
  } finally {
    sourceServer.close();
    await server.stop();
  }
});

test("agent config endpoint updates the same persisted settings", async () => {
  const server = await startServer();
  try {
    const updated = await jsonRequest(server.baseUrl, "/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({
        runtime: "stub",
        model: "auto",
        effort: "auto"
      })
    });

    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.settings.agentRuntime, "stub");
    assert.equal(updated.payload.settings.agentModel, "auto");
    assert.equal(updated.payload.settings.agentEffort, "auto");
    assert.equal(updated.payload.config.configuredRuntime, "stub");

    const settings = await jsonRequest(server.baseUrl, "/api/settings");
    assert.equal(settings.payload.settings.agentRuntime, "stub");
  } finally {
    await server.stop();
  }
});
