import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  makeMarkdownDoc,
  navigate,
  press,
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

// Put the caret at the start of the nth table cell (header cells first, then body
// cells in row order) and return whether the table ended up focused.
async function caretInCell(cdp, cellIndex) {
  return evaluate(
    cdp,
    `(() => {
      const table = document.querySelector('.editable-table');
      table.focus();
      const cell = table.querySelectorAll('th, td')[${cellIndex}];
      const r = document.createRange();
      r.selectNodeContents(cell);
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return document.activeElement === table;
    })()`
  );
}

async function caretCellText(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      let n = sel.getRangeAt(0).startContainer;
      n = n.nodeType === 1 ? n : n.parentElement;
      const cell = n?.closest('th, td');
      return cell ? cell.textContent.trim() : null;
    })()`
  );
}

test("Tab and Shift+Tab move the caret between table cells", async (t) => {
  await withApp(t, TABLE, async ({ browser }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    // Cells in order: th A, th B, td 1, td 2.
    assert.ok(await caretInCell(browser.cdp, 0)); // header "A"
    await press(browser.cdp, "Tab", { code: "Tab", keyCode: 9 });
    assert.equal(await caretCellText(browser.cdp), "B");
    await press(browser.cdp, "Tab", { code: "Tab", keyCode: 9 });
    assert.equal(await caretCellText(browser.cdp), "1");
    await press(browser.cdp, "Tab", { code: "Tab", keyCode: 9, shiftKey: true });
    assert.equal(await caretCellText(browser.cdp), "B");
  });
});

test("Tab in the last cell appends a new row", async (t) => {
  await withApp(t, TABLE, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 1");
    // Caret in the last cell (index 3 -> td "2").
    assert.ok(await caretInCell(browser.cdp, 3));
    await press(browser.cdp, "Tab", { code: "Tab", keyCode: 9 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 2");
    await waitForFileText(markdownPath, /\| 1 \| 2 \|\n\|\s*\|\s*\|/);
  });
});
