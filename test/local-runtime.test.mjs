import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function startServer(options = {}) {
  const configDir = await mkdtemp(join(tmpdir(), "skribe-config-"));
  const dataDir = await mkdtemp(join(tmpdir(), "skribe-data-"));
  const port = options.port ?? 47000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("node", ["server/index.mjs", "--no-open", ...(options.args ?? [])], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      SKRIBE_CONFIG_DIR: configDir,
      SKRIBE_DATA_DIR: dataDir,
      SKRIBE_NO_OPEN_BROWSER: "1",
      SKRIBE_AGENT_RUNTIME: options.env?.SKRIBE_AGENT_RUNTIME ?? "stub",
      SKRIBE_AGENT_MODEL: "auto",
      SKRIBE_AGENT_EFFORT: "auto",
      ...(options.env ?? {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForServer(baseUrl, child);

  return {
    baseUrl,
    child,
    configDir,
    dataDir,
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

async function waitForAgentIdle(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { payload } = await jsonRequest(baseUrl, "/api/document");
    if (payload.agentSession?.status === "idle" && payload.agentSession?.queueDepth === 0) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Agent did not finish in time");
}

async function createFakeLocalInferenceServer(options = {}) {
  const state = {
    requests: [],
    rejectResponseFormat: options.rejectResponseFormat ?? false,
    responseFormatRejectedOnce: false,
    emptyWithResponseFormatOnce: options.emptyWithResponseFormatOnce ?? false,
    emptyWithResponseFormatReturned: false,
    lowQualityOnce: options.lowQualityOnce ?? false,
    lowQualityReturned: false,
    responseShape: options.responseShape ?? "message",
    models: options.models ?? [{ id: "test-model" }, { id: "alt-model" }],
    completionContent:
      options.completionContent ??
      JSON.stringify({
        chatReply: "Hello from local model"
      })
  };

  const server = createHttpServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: state.models.map((model) => ({ id: model.id })) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(body);
        state.requests.push(parsed);

        if (state.rejectResponseFormat && parsed.response_format && !state.responseFormatRejectedOnce) {
          state.responseFormatRejectedOnce = true;
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "response_format not supported" } }));
          return;
        }

        if (
          state.emptyWithResponseFormatOnce &&
          parsed.response_format &&
          !state.emptyWithResponseFormatReturned
        ) {
          state.emptyWithResponseFormatReturned = true;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }));
          return;
        }

        const responseContent =
          state.lowQualityOnce && !state.lowQualityReturned
            ? ((state.lowQualityReturned = true), "..")
            : state.completionContent;

        const payload =
          state.responseShape === "text"
            ? { choices: [{ text: responseContent, finish_reason: "stop" }] }
            : { choices: [{ message: { content: responseContent }, finish_reason: "stop" }] };

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    state,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

function localRuntimeFromConfig(config) {
  return config.runtimes.find((runtime) => runtime.id === "local");
}

test("local runtime detection reports available models from an OpenAI-compatible server", async () => {
  const fake = await createFakeLocalInferenceServer();
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "stub",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    const { payload } = await jsonRequest(server.baseUrl, "/api/agent/runtimes");
    const local = localRuntimeFromConfig(payload);
    assert.ok(local);
    assert.equal(local.available, true);
    assert.equal(local.defaultModel, "test-model");
    assert.deepEqual(
      local.models.map((model) => model.id),
      ["test-model", "alt-model"]
    );
    assert.match(local.notes.join(" "), /OpenAI-compatible endpoint/);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime detection reports unavailable when no server is reachable", async () => {
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "stub",
      SKRIBE_LOCAL_BASE_URL: "http://127.0.0.1:59999/v1"
    }
  });

  try {
    const { payload } = await jsonRequest(server.baseUrl, "/api/agent/runtimes");
    const local = localRuntimeFromConfig(payload);
    assert.ok(local);
    assert.equal(local.available, false);
    assert.match(local.notes.join(" "), /No local inference server detected/);
    assert.match(local.notes.join(" "), /59999/);
  } finally {
    await server.stop();
  }
});

test("agent config accepts local runtime when the inference server is available", async () => {
  const fake = await createFakeLocalInferenceServer();
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "stub",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    const updated = await jsonRequest(server.baseUrl, "/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({ runtime: "local", model: "auto", effort: "auto" })
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.config.configuredRuntime, "local");
    assert.equal(updated.payload.config.resolvedRuntime, "local");
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("agent config rejects local runtime when the inference server is unavailable", async () => {
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "stub",
      SKRIBE_LOCAL_BASE_URL: "http://127.0.0.1:59999/v1"
    }
  });

  try {
    const updated = await jsonRequest(server.baseUrl, "/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({ runtime: "local", model: "auto", effort: "auto" })
    });
    assert.equal(updated.response.status, 400);
    assert.match(updated.payload.error, /Local inference is not available/);
  } finally {
    await server.stop();
  }
});

test("local runtime executes chat turns and parses JSON replies", async () => {
  const fake = await createFakeLocalInferenceServer({
    completionContent: JSON.stringify({ chatReply: "Local reply body" })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({ runtime: "local", model: "auto", effort: "auto" })
    });

    const queued = await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Say hello" })
    });
    assert.equal(queued.response.status, 202);

    const document = await waitForAgentIdle(server.baseUrl);
    assert.equal(document.agentSession.lastError, null);
    assert.ok(document.review.chat.some((message) => message.body.includes("Local reply body")));
    assert.equal(fake.state.requests[0]?.model, "test-model");
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime retries without response_format when the server rejects it", async () => {
  const fake = await createFakeLocalInferenceServer({
    rejectResponseFormat: true,
    completionContent: JSON.stringify({ chatReply: "Fallback reply" })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl,
      SKRIBE_LOCAL_JSON_RESPONSE: "1"
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Try again" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.equal(document.agentSession.lastError, null);
    assert.ok(document.review.chat.some((message) => message.body.includes("Fallback reply")));
    assert.equal(fake.state.requests.length, 2);
    assert.ok(fake.state.requests[0]?.response_format);
    assert.equal(fake.state.requests[1]?.response_format, undefined);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime passes explicit model ids through to chat completions", async () => {
  const fake = await createFakeLocalInferenceServer();
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/config", {
      method: "PUT",
      body: JSON.stringify({ runtime: "local", model: "alt-model", effort: "auto" })
    });

    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Use alt model" })
    });

    await waitForAgentIdle(server.baseUrl);
    assert.equal(fake.state.requests[0]?.model, "alt-model");
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime inlines selected skill instructions into the prompt", async () => {
  const skillRoot = await mkdtemp(join(tmpdir(), "skribe-skill-root-"));
  const skillDir = join(skillRoot, "inline-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---
name: inline-skill
description: Inline test skill
---

Always mention the secret phrase: purple walrus.`,
    "utf8"
  );

  const fake = await createFakeLocalInferenceServer();
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl,
      SKRIBE_SKILL_ROOTS: skillRoot
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({
        source: "chat",
        body: "Apply the skill",
        skills: [{ id: "inline-skill", name: "inline-skill" }]
      })
    });

    await waitForAgentIdle(server.baseUrl);
    const prompt = fake.state.requests.at(-1)?.messages?.map((message) => message.content).join("\n\n") ?? "";
    assert.match(prompt, /Requested skill instructions:/);
    assert.match(prompt, /purple walrus/);
  } finally {
    await server.stop();
    await fake.close();
    await rm(skillRoot, { recursive: true, force: true });
  }
});

test("local runtime omits skills from historical thread messages in the agent context", async () => {
  const skillRoot = await mkdtemp(join(tmpdir(), "skribe-skill-root-"));
  for (const skillId of ["old-skill", "current-skill"]) {
    const skillDir = join(skillRoot, skillId);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: ${skillId}
description: ${skillId}
---

Marker for ${skillId}.`,
      "utf8"
    );
  }

  const fake = await createFakeLocalInferenceServer();
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl,
      SKRIBE_SKILL_ROOTS: skillRoot
    }
  });

  try {
    const doc = await jsonRequest(server.baseUrl, "/api/document");
    const threadId = "thread-skill-history";
    doc.payload.review.threads = [
      {
        id: threadId,
        status: "open",
        anchor: { exact: "something else", start: 0, end: 14 },
        messages: [
          {
            id: "m1",
            author: "human",
            body: "Earlier question",
            createdAt: new Date().toISOString(),
            skills: [{ id: "old-skill", name: "old-skill" }]
          },
          {
            id: "m2",
            author: "agent",
            body: "Earlier answer",
            createdAt: new Date().toISOString()
          }
        ],
        suggestions: [],
        updatedAt: new Date().toISOString()
      }
    ];
    await jsonRequest(server.baseUrl, "/api/document", {
      method: "PUT",
      body: JSON.stringify({ markdown: doc.payload.markdown, review: doc.payload.review })
    });

    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({
        source: "thread",
        threadId,
        body: "Follow up question",
        skills: [{ id: "current-skill", name: "current-skill" }]
      })
    });

    await waitForAgentIdle(server.baseUrl);
    const prompt = fake.state.requests.at(-1)?.messages?.map((message) => message.content).join("\n\n") ?? "";
    assert.match(prompt, /Marker for current-skill/);
    assert.doesNotMatch(prompt, /Marker for old-skill/);
    assert.doesNotMatch(prompt, /"skills"\s*:\s*\[\s*\{\s*"id"\s*:\s*"old-skill"/);
  } finally {
    await server.stop();
    await fake.close();
    await rm(skillRoot, { recursive: true, force: true });
  }
});

test("local runtime extracts thread reply bodies from JSON envelopes", async () => {
  const fake = await createFakeLocalInferenceServer({
    completionContent: JSON.stringify({
      threadReplies: [{ threadId: "wrong-thread-id", body: "Try a concrete activation story.\n\nThen add a product-led lesson." }]
    })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    const doc = await jsonRequest(server.baseUrl, "/api/document");
    const threadId = "thread-json-envelope";
    doc.payload.review.threads = [
      {
        id: threadId,
        status: "open",
        anchor: { exact: "something else", start: 0, end: 14 },
        messages: [{ id: "m1", author: "human", body: "what should i write next?", createdAt: new Date().toISOString() }],
        suggestions: [],
        updatedAt: new Date().toISOString()
      }
    ];
    await jsonRequest(server.baseUrl, "/api/document", {
      method: "PUT",
      body: JSON.stringify({ markdown: doc.payload.markdown, review: doc.payload.review })
    });

    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({
        source: "thread",
        threadId,
        body: "what should i write next?"
      })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    const thread = document.review.threads.find((item) => item.id === threadId);
    const agentMessage = thread?.messages.find((message) => message.author === "agent");
    assert.ok(agentMessage);
    assert.match(agentMessage.body, /concrete activation story/);
    assert.doesNotMatch(agentMessage.body, /"threadReplies"/);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime rejects low-quality truncated replies", async () => {
  const fake = await createFakeLocalInferenceServer({
    completionContent: "Given"
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Say hello" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.match(document.agentSession.lastError || "", /incomplete response/i);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime maps reply text into threadReplies for thread turns", async () => {
  const fake = await createFakeLocalInferenceServer({
    completionContent: JSON.stringify({
      reply: "Try opening with a concrete product-led lesson from your last launch."
    })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    const doc = await jsonRequest(server.baseUrl, "/api/document");
    const threadId = "thread-local-test";
    doc.payload.review.threads = [
      {
        id: threadId,
        status: "open",
        anchor: { exact: "something else", start: 0, end: 14 },
        messages: [{ id: "m1", author: "human", body: "what should i write here?", createdAt: new Date().toISOString() }],
        suggestions: [],
        updatedAt: new Date().toISOString()
      }
    ];
    await jsonRequest(server.baseUrl, "/api/document", {
      method: "PUT",
      body: JSON.stringify({ markdown: doc.payload.markdown, review: doc.payload.review })
    });

    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({
        source: "thread",
        threadId,
        body: "what should i write here?"
      })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    const thread = document.review.threads.find((item) => item.id === threadId);
    assert.ok(thread?.messages.some((message) => message.body.includes("product-led lesson")));
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime parses fenced JSON completions", async () => {
  const fake = await createFakeLocalInferenceServer({
    completionContent: "```json\n{\"chatReply\":\"Fenced local reply\"}\n```"
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Fence test" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.ok(document.review.chat.some((message) => message.body.includes("Fenced local reply")));
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime reads base URL and max tokens from settings", async () => {
  const fake = await createFakeLocalInferenceServer();
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local"
    }
  });

  try {
    const initial = await jsonRequest(server.baseUrl, "/api/settings");
    await jsonRequest(server.baseUrl, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          ...initial.payload.settings,
          agentRuntime: "local",
          localInferenceBaseUrl: fake.baseUrl,
          localInferenceMaxTokens: 7777
        }
      })
    });

    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Settings test" })
    });

    await waitForAgentIdle(server.baseUrl);
    const request = fake.state.requests.at(-1);
    assert.equal(request?.max_tokens, 7777);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime retries without response_format when the server returns an empty completion", async () => {
  const fake = await createFakeLocalInferenceServer({
    emptyWithResponseFormatOnce: true,
    completionContent: JSON.stringify({ chatReply: "Recovered after empty JSON-mode response" })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl,
      SKRIBE_LOCAL_JSON_RESPONSE: "1"
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Say hello" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.equal(document.agentSession.lastError, null);
    assert.ok(document.review.chat.some((message) => message.body.includes("Recovered after empty JSON-mode response")));
    assert.equal(fake.state.requests.length, 2);
    assert.ok(fake.state.requests[0]?.response_format);
    assert.equal(fake.state.requests[1]?.response_format, undefined);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime retries with a compact prompt after an incomplete response", async () => {
  const fake = await createFakeLocalInferenceServer({
    lowQualityOnce: true,
    completionContent: JSON.stringify({ chatReply: "Compact retry worked" })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Say hello" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.equal(document.agentSession.lastError, null);
    assert.ok(document.review.chat.some((message) => message.body.includes("Compact retry worked")));
    assert.equal(fake.state.requests.length, 2);
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime reads completion text from choice.text responses", async () => {
  const fake = await createFakeLocalInferenceServer({
    responseShape: "text",
    completionContent: JSON.stringify({ chatReply: "Text field reply" })
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Text field test" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.ok(document.review.chat.some((message) => message.body.includes("Text field reply")));
  } finally {
    await server.stop();
    await fake.close();
  }
});

test("local runtime rejects punctuation-only truncated replies", async () => {
  const fake = await createFakeLocalInferenceServer({
    completionContent: ".."
  });
  const server = await startServer({
    env: {
      SKRIBE_AGENT_RUNTIME: "local",
      SKRIBE_LOCAL_BASE_URL: fake.baseUrl
    }
  });

  try {
    await jsonRequest(server.baseUrl, "/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ source: "chat", body: "Say hello" })
    });

    const document = await waitForAgentIdle(server.baseUrl);
    assert.match(document.agentSession.lastError || "", /incomplete response/i);
  } finally {
    await server.stop();
    await fake.close();
  }
});
