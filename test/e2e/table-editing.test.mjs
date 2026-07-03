import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  makeMarkdownDoc,
  navigate,
  removeTempDir,
  startSkribeServer,
  waitFor,
  waitForFileText
} from "./helpers.mjs";

async function withApp(t, markdown, callback) {
  const browser = await browserTest(t);
  if (!browser) return;
  const { rootDir, markdownPath } = await makeMarkdownDoc("draft.md", markdown);
  const server = await startSkribeServer(markdownPath);
  try {
    await disableToneSetup(server.baseUrl);
    await navigate(browser.cdp, server.baseUrl);
    await callback({ browser, markdownPath });
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
}

// The structure controls are hover-revealed (opacity/pointer-events), so drive them
// with a programmatic click, which ignores visibility — the same handler a real
// click fires.
async function clickControl(cdp, selector, index = 0) {
  return evaluate(
    cdp,
    `(() => {
      const el = document.querySelectorAll('${selector}')[${index}];
      if (!el) return false;
      el.click();
      return true;
    })()`
  );
}

async function tableCounts(cdp) {
  return evaluate(
    cdp,
    `(() => ({
      cols: document.querySelectorAll('.editable-table thead th').length,
      rows: document.querySelectorAll('.editable-table tbody tr').length
    }))()`
  );
}

const TABLE = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";

test("the add-row control appends an empty body row", async (t) => {
  await withApp(t, TABLE, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    assert.deepEqual(await tableCounts(browser.cdp), { cols: 2, rows: 1 });
    assert.ok(await clickControl(browser.cdp, ".table-add-row"));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 2");
    await waitForFileText(markdownPath, /\| 1 \| 2 \|\n\|\s*\|\s*\|/);
  });
});

test("the add-column control appends an empty column", async (t) => {
  await withApp(t, TABLE, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    assert.ok(await clickControl(browser.cdp, ".table-add-column"));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table thead th').length === 3");
    // Header row now has three cells.
    await waitForFileText(markdownPath, /\| A \| B \|\s*\|/);
  });
});

test("the per-row delete control removes that body row", async (t) => {
  const twoRows = "| A | B |\n| --- | --- |\n| keep | x |\n| drop | y |\n";
  await withApp(t, twoRows, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 2");
    // Delete the second body row (index 1).
    assert.ok(await clickControl(browser.cdp, ".table-delete-row", 1));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 1");
    // "keep" ends the table only after the delete saves (originally "drop" followed).
    await waitForFileText(markdownPath, /\| keep \| x \|\s*$/);
    const saved = await readFile(markdownPath, "utf8");
    assert.match(saved, /keep/);
    assert.doesNotMatch(saved, /drop/);
  });
});

test("the per-column delete control removes that column (3+ columns only)", async (t) => {
  const threeCol = "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n";
  await withApp(t, threeCol, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table thead th').length === 3");
    // Delete the middle column (index 1 -> "B").
    assert.ok(await clickControl(browser.cdp, ".table-delete-column", 1));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table thead th').length === 2");
    await waitForFileText(markdownPath, /\| A \| C \|/);
    const saved = await readFile(markdownPath, "utf8");
    assert.doesNotMatch(saved, /\bB\b/);
    assert.doesNotMatch(saved, /\b2\b/);
  });
});

test("a two-column table exposes no delete-column control (min two columns)", async (t) => {
  await withApp(t, TABLE, async ({ browser }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    assert.equal(
      await evaluate(browser.cdp, "document.querySelectorAll('.table-delete-column').length"),
      0
    );
  });
});
