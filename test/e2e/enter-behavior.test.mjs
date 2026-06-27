import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  insertText,
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
    await callback({ browser, server, markdownPath });
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
}

const blockTexts = (cdp) =>
  evaluate(
    cdp,
    "Array.from(document.querySelectorAll('.editable-document [data-block-id]')).map((n) => (n.textContent || '').replace(/\\u200b/g, ''))"
  );
const blockCount = (cdp) => evaluate(cdp, "document.querySelectorAll('.editable-document [data-block-id]').length");

// Wait until the caret has settled into the n-th editable block (as a real writer
// would before typing) — the split places the caret a frame or two after the new
// block renders.
const waitCaretInBlock = (cdp, n) =>
  waitFor(
    cdp,
    `(() => {
      const blocks = document.querySelectorAll('.editable-document [data-block-id]');
      const b = blocks[${n}];
      return Boolean(b && (b === document.activeElement || b.contains(document.activeElement)));
    })()`
  );

async function caretAtEnd(cdp, blockId) {
  await evaluate(
    cdp,
    `(() => {
      const b = document.querySelector('[data-block-id="${blockId}"]');
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
}

test("Enter instantly creates a new block and typing goes into it (no corruption)", async (t) => {
  await withApp(t, "Alpha\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 1");
    await caretAtEnd(browser.cdp, "block-0");

    // Enter -> a second block appears immediately.
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");

    // Typing lands in the new (second) block.
    await waitCaretInBlock(browser.cdp, 1);
    await insertText(browser.cdp, "Beta");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 3");
    await waitCaretInBlock(browser.cdp, 2);
    await insertText(browser.cdp, "Gamma");

    // The saved markdown is exactly three paragraphs — no duplication / no
    // content landing in the wrong block.
    await waitForFileText(markdownPath, /Gamma/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "Alpha\n\nBeta\n\nGamma\n");

    assert.deepEqual(await blockTexts(browser.cdp), ["Alpha", "Beta", "Gamma"]);
  });
});

test("Enter mid-paragraph splits at the caret instantly", async (t) => {
  await withApp(t, "Helloworld\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 1");
    // caret after "Hello"
    await evaluate(
      browser.cdp,
      `(() => {
        const b = document.querySelector('[data-block-id="block-0"]');
        b.focus();
        const r = document.createRange();
        r.setStart(b.firstChild, 5);
        r.collapse(true);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return true;
      })()`
    );
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");
    await waitForFileText(markdownPath, /Hello\n\nworld/);
    assert.deepEqual(await blockTexts(browser.cdp), ["Hello", "world"]);
  });
});

test("Enter in a list creates a sibling item instantly", async (t) => {
  await withApp(t, "- one\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 1");
    await caretAtEnd(browser.cdp, "block-0");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 2");
    await waitCaretInBlock(browser.cdp, 1);
    await insertText(browser.cdp, "two");
    await waitForFileText(markdownPath, /- two/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "- one\n- two\n");
  });
});

async function caretAtStart(cdp, blockId) {
  await evaluate(
    cdp,
    `(() => {
      const b = document.querySelector('[data-block-id="${blockId}"]');
      b.focus();
      const r = document.createRange();
      r.selectNodeContents(b);
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    })()`
  );
}

test("Backspace at the start of an empty block removes it and moves the caret to the previous block", async (t) => {
  // "Alpha" then an empty block (trailing blank paragraph kept via Enter).
  await withApp(t, "Alpha\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 1");
    await caretAtEnd(browser.cdp, "block-0");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");
    await waitCaretInBlock(browser.cdp, 1);

    // Backspace in the empty second block removes it, caret returns to "Alpha".
    await press(browser.cdp, "Backspace", { code: "Backspace", keyCode: 8 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 1");
    await waitCaretInBlock(browser.cdp, 0);

    // Typing continues at the end of the previous block.
    await insertText(browser.cdp, "!");
    await waitForFileText(markdownPath, /Alpha!/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "Alpha!\n");
  });
});

test("Backspace at the start of a non-empty block joins it onto the previous block", async (t) => {
  await withApp(t, "Alpha\n\nBeta\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");
    await caretAtStart(browser.cdp, "block-1");
    await press(browser.cdp, "Backspace", { code: "Backspace", keyCode: 8 });
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 1");
    await waitForFileText(markdownPath, /AlphaBeta/);
    const saved = await readFile(markdownPath, "utf8");
    assert.equal(saved, "AlphaBeta\n");
    assert.deepEqual(await blockTexts(browser.cdp), ["AlphaBeta"]);
  });
});

test("Backspace mid-text deletes a character (does not merge)", async (t) => {
  await withApp(t, "Alpha\n\nBeta\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");
    await caretAtEnd(browser.cdp, "block-1");
    await press(browser.cdp, "Backspace", { code: "Backspace", keyCode: 8 });
    await waitForFileText(markdownPath, /Bet\n/);
    assert.deepEqual(await blockTexts(browser.cdp), ["Alpha", "Bet"]);
  });
});

test("Shift+Enter is a soft break that stays in one block", async (t) => {
  await withApp(t, "one\n", async ({ browser }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 1");
    await caretAtEnd(browser.cdp, "block-0");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13, shiftKey: true });
    await insertText(browser.cdp, "two");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await blockCount(browser.cdp), 1);
  });
});
