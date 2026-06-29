// Run each e2e test file in its own `node --test` process. The bundled
// `node --test test/e2e/*.test.mjs` run can deadlock on browser-startup
// contention (a single hung file stalls the whole run indefinitely); isolating
// each file with a hard per-file timeout avoids the hang and turns a stuck file
// into a real, visible failure instead.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = "test/e2e";
const PER_FILE_TIMEOUT_MS = 10 * 60 * 1000;

const files = readdirSync(dir)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

const failed = [];
for (const file of files) {
  const fullPath = path.join(dir, file);
  process.stdout.write(`\n=== ${fullPath} ===\n`);
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", fullPath], {
    stdio: "inherit",
    timeout: PER_FILE_TIMEOUT_MS
  });
  if (result.error?.code === "ETIMEDOUT" || result.signal) {
    console.error(`\n✖ ${fullPath} timed out or was killed (${result.signal ?? result.error?.code})`);
    failed.push(file);
  } else if (result.status !== 0) {
    console.error(`\n✖ ${fullPath} failed (exit ${result.status})`);
    failed.push(file);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} e2e file(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${files.length} e2e files passed.`);
