import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const serverPath = join(root, "server", "index.mjs");
const binPath = join(root, "bin", "skribe.mjs");

const testEnv = {
  SKRIBE_NO_OPEN_BROWSER: "1"
};

function runSkribe(args, env = {}) {
  return spawnSync(process.execPath, [serverPath, ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...testEnv,
      PORT: String(48000 + Math.floor(Math.random() * 1000)),
      ...env
    },
    encoding: "utf8"
  });
}

function runSkribeBin(args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...testEnv,
      PORT: String(48000 + Math.floor(Math.random() * 1000)),
      ...env
    },
    encoding: "utf8"
  });
}

test("CLI prints version and help without starting the server", () => {
  const version = runSkribe(["--version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);

  const help = runSkribe(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /skribe doctor/);
  assert.match(help.stdout, /skribe runtimes/);
});

test("published bin wrapper forwards version and help flags", () => {
  const version = runSkribeBin(["--version"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
  assert.doesNotMatch(version.stdout, /Skribe running at/);

  const help = runSkribeBin(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /skribe doctor/);
  assert.doesNotMatch(help.stdout, /Skribe running at/);
});

test("CLI status reports when no local server is running", () => {
  const status = runSkribe(["status"], { PORT: "48991" });
  assert.equal(status.status, 0);
  assert.match(status.stdout, /not running/);
});

test("CLI config uses the configured local storage directory", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "skribe-cli-config-"));
  try {
    const result = runSkribe(["config"], {
      SKRIBE_CONFIG_DIR: configDir,
      SKRIBE_AGENT_RUNTIME: "auto"
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(configDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout, /Agent runtime: auto/);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

test("published bin resolves relative document paths from the invoker cwd", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skribe-cli-cwd-"));
  const markdownPath = join(rootDir, "draft.md");
  await writeFile(markdownPath, "# Draft\n\nBody.\n", "utf8");

  try {
    const exported = spawnSync(process.execPath, [binPath, "export", "draft.md"], {
      cwd: rootDir,
      env: {
        ...process.env,
        ...testEnv,
        PORT: String(48000 + Math.floor(Math.random() * 1000))
      },
      encoding: "utf8"
    });
    assert.equal(exported.status, 0, exported.stderr || exported.stdout);
    assert.equal(exported.stdout, "# Draft\n\nBody.\n");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("CLI fails clearly when an external document path does not exist", () => {
  const result = runSkribe(["missing-draft.md"], {
    PORT: String(48000 + Math.floor(Math.random() * 1000))
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Document not found/);
});

test("CLI export can print or write a Markdown file", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skribe-cli-export-"));
  const markdownPath = join(rootDir, "draft.md");
  const outPath = join(rootDir, "clean.md");
  await writeFile(markdownPath, "# Draft\n\nBody.\n", "utf8");

  try {
    const printed = runSkribe(["export", markdownPath]);
    assert.equal(printed.status, 0);
    assert.equal(printed.stdout, "# Draft\n\nBody.\n");

    const written = runSkribe(["export", markdownPath, "--out", outPath]);
    assert.equal(written.status, 0);
    assert.equal(await readFile(outPath, "utf8"), "# Draft\n\nBody.\n");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
