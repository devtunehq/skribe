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

// Select from the first block through the last. A native cross-block drag yields
// a selection whose range starts in the first block and ends in the last (even
// though toString() is visually clamped to one block); setBaseAndExtent
// reproduces exactly that range structure, which is what the formatter reads.
async function selectAllBlocks(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const blocks = document.querySelectorAll('.editable-document [data-block-id]');
      const last = blocks[blocks.length - 1];
      last.focus();
      const startNode = blocks[0].firstChild || blocks[0];
      const endNode = last.firstChild || last;
      getSelection().setBaseAndExtent(startNode, 0, endNode, (endNode.textContent || '').length);
      const range = getSelection().getRangeAt(0);
      const bid = (n) => n && n.parentElement?.closest?.('[data-block-id]')?.getAttribute('data-block-id');
      return { start: bid(range.startContainer), end: bid(range.endContainer) };
    })()`
  );
}

// Drag across blocks with a real pointer. The editor builds its OWN cross-block
// selection (pendingSelectionDraft) and clears the native selection, so this is
// the gesture that matters — and the one a scripted native Range can't model.
async function pointerDragAllBlocks(cdp) {
  const r = await evaluate(
    cdp,
    `(() => {
      const b = document.querySelectorAll('.editable-document [data-block-id]');
      const f = b[0].getBoundingClientRect();
      const l = b[b.length - 1].getBoundingClientRect();
      return { fx: f.left + 1, fy: f.top + f.height / 2, lx: l.right - 2, ly: l.top + l.height / 2 };
    })()`
  );
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.fx, y: r.fy, pointerType: "mouse" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.fx, y: r.fy, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.fx + ((r.lx - r.fx) * i) / 12, y: r.fy + ((r.ly - r.fy) * i) / 12, button: "left", buttons: 1, pointerType: "mouse" });
    await new Promise((res) => setTimeout(res, 12));
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.lx, y: r.ly, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
  await new Promise((res) => setTimeout(res, 150));
}

test("cross-block drag selection + Ctrl+Shift+7 numbers every list item", async (t) => {
  await withApp(t, "- a\n- b\n- c\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 3");
    await pointerDragAllBlocks(browser.cdp);
    await press(browser.cdp, "7", { code: "Digit7", keyCode: 55, ctrlKey: true, shiftKey: true });
    await waitForFileText(markdownPath, /\d\. c/);
    const saved = await readFile(markdownPath, "utf8");
    const lines = saved.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) assert.match(line, /^\d+\. /);
  });
});

test("cross-block drag selection + Ctrl+Shift+8 bullets every paragraph", async (t) => {
  await withApp(t, "x\n\ny\n\nz\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 3");
    await pointerDragAllBlocks(browser.cdp);
    await press(browser.cdp, "8", { code: "Digit8", keyCode: 56, ctrlKey: true, shiftKey: true });
    await waitForFileText(markdownPath, /- z/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "- x\n- y\n- z\n");
  });
});

test("Ctrl+Shift+8 on a multi-block selection turns every block into a bullet", async (t) => {
  await withApp(t, "Alpha\n\nBeta\n\nGamma\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 3");
    const range = await selectAllBlocks(browser.cdp);
    assert.equal(range.start, "block-0");
    assert.equal(range.end, "block-2");

    await press(browser.cdp, "8", { code: "Digit8", keyCode: 56, ctrlKey: true, shiftKey: true });

    await waitForFileText(browser.cdp ? markdownPath : markdownPath, /- Gamma/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "- Alpha\n- Beta\n- Gamma\n");
  });
});

test("Ctrl+Shift+7 on a multi-block selection turns every block into a numbered item", async (t) => {
  await withApp(t, "Alpha\n\nBeta\n\nGamma\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 3");
    const range = await selectAllBlocks(browser.cdp);
    assert.equal(range.start, "block-0");
    assert.equal(range.end, "block-2");

    await press(browser.cdp, "7", { code: "Digit7", keyCode: 55, ctrlKey: true, shiftKey: true });

    await waitForFileText(markdownPath, /\d\. Gamma/);
    const saved = await readFile(markdownPath, "utf8");
    // Every selected block becomes an ordered-list item.
    const lines = saved.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) assert.match(line, /^\d+\. /);
    assert.match(saved, /Alpha/);
    assert.match(saved, /Beta/);
    assert.match(saved, /Gamma/);
  });
});

test("single-block list conversion still works", async (t) => {
  await withApp(t, "Alpha\n\nBeta\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");
    await evaluate(
      browser.cdp,
      `(() => {
        const b = document.querySelector('[data-block-id="block-1"]');
        b.focus();
        const r = document.createRange();
        r.selectNodeContents(b);
        r.collapse(false);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return true;
      })()`
    );
    await press(browser.cdp, "8", { code: "Digit8", keyCode: 56, ctrlKey: true, shiftKey: true });
    await waitForFileText(markdownPath, /- Beta/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "Alpha\n\n- Beta\n");
  });
});

test("conversion still hits every block when the selection ends on a boundary node", async (t) => {
  // A real drag across list items can leave the selection's end on a container /
  // marker node rather than inside the last item's editable; the formatter must
  // still convert all selected blocks, not collapse to one.
  await withApp(t, "- a\n- b\n- c\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 3");
    await evaluate(
      browser.cdp,
      `(() => {
        const blocks = document.querySelectorAll('.editable-document [data-block-id]');
        blocks[0].focus();
        const doc = document.querySelector('.editable-document');
        const startNode = blocks[0].firstChild || blocks[0];
        // End on the document container itself — endContainer is not inside any
        // [data-block-id], so endpoint resolution would yield null.
        getSelection().setBaseAndExtent(startNode, 0, doc, doc.childNodes.length);
        return true;
      })()`
    );
    await press(browser.cdp, "7", { code: "Digit7", keyCode: 55, ctrlKey: true, shiftKey: true });
    await waitForFileText(markdownPath, /\d\. c/);
    const saved = await readFile(markdownPath, "utf8");
    const lines = saved.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) assert.match(line, /^\d+\. /);
  });
});
