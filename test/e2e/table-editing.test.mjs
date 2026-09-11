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
    await waitForFileText(markdownPath, /\| 1 \| 2 \|\n\|[ \t]*\|[ \t]*\|/);
    // The new empty row shouldn't collapse thinner than the filled one (empty cells
    // render a <br> so they keep a full line box).
    const heights = await evaluate(
      browser.cdp,
      `(() => {
        const rows = document.querySelectorAll('.editable-table tbody tr');
        return { filled: rows[0].offsetHeight, empty: rows[1].offsetHeight };
      })()`
    );
    assert.ok(
      heights.empty >= heights.filled * 0.9,
      `empty row (${heights.empty}px) collapsed vs filled row (${heights.filled}px)`
    );
  });
});

test("the add-column control appends an empty column", async (t) => {
  await withApp(t, TABLE, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    assert.ok(await clickControl(browser.cdp, ".table-add-column"));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table thead th').length === 3");
    // Header row now has three cells (match only within the single header line).
    await waitForFileText(markdownPath, /\| A \| B \|[ \t]*\|/);
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
    await waitForFileText(markdownPath, /\| keep \| x \|[ \t]*\n?$/);
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

test("a single-row table exposes no delete-row control (min one body row)", async (t) => {
  await withApp(t, TABLE, async ({ browser }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 1");
    assert.equal(
      await evaluate(browser.cdp, "document.querySelectorAll('.table-delete-row').length"),
      0
    );
  });
});

test("a cell containing a pipe survives a structural edit without corruption", async (t) => {
  // "a | b" is stored escaped as "a \\| b"; adding a row round-trips through the DOM
  // (htmlToInlineMarkdown -> serializeMarkdownTable) and must not double the backslash.
  const md = "| h1 | h2 |\n| --- | --- |\n| a \\| b | c |\n";
  await withApp(t, md, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    assert.ok(await clickControl(browser.cdp, ".table-add-row"));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 2");
    await waitForFileText(markdownPath, /a \\\| b/);
    const saved = await readFile(markdownPath, "utf8");
    assert.doesNotMatch(saved, /\\\\/); // no doubled backslash
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
    await waitForFileText(markdownPath, /\| 1 \| 2 \|\n\|[ \t]*\|[ \t]*\|/);
  });
});

test("insert-row-above and insert-column-before place empty cells between existing ones", async (t) => {
  const twoRows = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n";
  await withApp(t, twoRows, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 2");
    assert.ok(await clickControl(browser.cdp, ".table-insert-row", 1));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table tbody tr').length === 3");
    await waitForFileText(markdownPath, /\| 1 \| 2 \|\n\|[ \t]*\|[ \t]*\|\n\| 3 \| 4 \|/);

    assert.ok(await clickControl(browser.cdp, ".table-insert-column", 1));
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-table thead th').length === 3");
    await waitForFileText(markdownPath, /\| A \|[ \t]*\| B \|/);
  });
});

function selectTextInTableExpression(text) {
  return `(() => {
    const table = document.querySelector('.editable-table');
    if (!table) return { ok: false, reason: 'missing table' };
    const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.includes(${JSON.stringify(text)})) node = walker.nextNode();
    if (!node) return { ok: false, reason: 'missing text' };
    const start = node.textContent.indexOf(${JSON.stringify(text)});
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + ${JSON.stringify(text)}.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    table.focus();
    table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 40 }));
    return { ok: true, selected: selection.toString() };
  })()`;
}

test("insert-link wraps the selected table cell, not a different cell", async (t) => {
  const md =
    "| Example | What |\n| --- | --- |\n| Grafana Cloud | Managed observability services for metrics and visualisation. |\n| ClickHouse Cloud | Operating and maintaining PostgreSQL. |\n";
  await withApp(t, md, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-table')");
    const selected = await evaluate(browser.cdp, selectTextInTableExpression("ClickHouse Cloud"));
    assert.deepEqual(selected, { ok: true, selected: "ClickHouse Cloud" });
    await waitFor(browser.cdp, "Boolean(document.querySelector('.floating-format-toolbar button[title=\"Insert link\"]'))");
    await evaluate(browser.cdp, "document.querySelector('.floating-format-toolbar button[title=\"Insert link\"]').click()");
    await waitFor(browser.cdp, "Boolean(document.querySelector('.link-popover input'))");
    await evaluate(
      browser.cdp,
      `(() => {
        const input = document.querySelector('.link-popover input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://clickhouse.com');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.link-popover .primary-button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        return true;
      })()`
    );
    await waitForFileText(markdownPath, /\[ClickHouse Cloud\]\(https:\/\/clickhouse\.com\)/);
    const saved = await readFile(markdownPath, "utf8");
    assert.match(saved, /Managed observability services for metrics and visualisation\./);
    assert.doesNotMatch(saved, /metric\[ClickHouse Cloud\]/);
    await waitFor(
      browser.cdp,
      "Array.from(document.querySelectorAll('.editable-table a')).some((anchor) => anchor.textContent === 'ClickHouse Cloud' && anchor.href.startsWith('https://clickhouse.com'))"
    );
  });
});
