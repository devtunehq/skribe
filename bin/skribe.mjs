#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(binDir, "..");
const serverPath = resolve(projectRoot, "server", "index.mjs");
const args = process.argv.slice(2);
// Under npx/global install the bin often starts inside the package directory.
// INIT_CWD points at the directory where the user invoked the command.
const invokerCwd =
  process.cwd() === projectRoot && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();

const child = spawn(process.execPath, [serverPath, ...args], {
  cwd: invokerCwd,
  stdio: "inherit",
  env: {
    ...process.env,
    INIT_CWD: invokerCwd
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
