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
    await callback({ browser, markdownPath });
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
}

// Collapse the caret to the very start of a block so an input rule fires as if the
// writer typed the prefix at the line start.
async function caretAtStart(cdp, blockId) {
  return evaluate(
    cdp,
    `(() => {
      const b = document.querySelector('[data-block-id="${blockId}"]');
      b.focus();
      const r = document.createRange();
      r.setStart(b.firstChild || b, 0);
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    })()`
  );
}

async function caretInBlock(cdp, blockId) {
  return evaluate(
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

test("typing '# ' at the start of a paragraph makes an H1", async (t) => {
  await withApp(t, "hello\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretAtStart(browser.cdp, "block-0");
    await insertText(browser.cdp, "#");
    await press(browser.cdp, " ", { code: "Space", keyCode: 32 });
    await waitForFileText(markdownPath, /^# hello/);
    assert.equal(await readFile(markdownPath, "utf8"), "# hello\n");
  });
});

test("typing '### ' makes a deeper heading", async (t) => {
  await withApp(t, "hello\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretAtStart(browser.cdp, "block-0");
    await insertText(browser.cdp, "###");
    await press(browser.cdp, " ", { code: "Space", keyCode: 32 });
    await waitForFileText(markdownPath, /^### hello/);
    assert.equal(await readFile(markdownPath, "utf8"), "### hello\n");
  });
});

test("typing '> ' at the start of a paragraph makes a blockquote", async (t) => {
  await withApp(t, "hello\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretAtStart(browser.cdp, "block-0");
    await insertText(browser.cdp, ">");
    await press(browser.cdp, " ", { code: "Space", keyCode: 32 });
    await waitForFileText(markdownPath, /^> hello/);
    assert.equal(await readFile(markdownPath, "utf8"), "> hello\n");
  });
});

test("Ctrl+Alt+4 turns the active paragraph into an H4", async (t) => {
  await withApp(t, "hello\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretInBlock(browser.cdp, "block-0");
    await press(browser.cdp, "4", { code: "Digit4", keyCode: 52, ctrlKey: true, altKey: true });
    await waitForFileText(markdownPath, /^#### hello/);
    assert.equal(await readFile(markdownPath, "utf8"), "#### hello\n");
  });
});

test("Ctrl+Shift+. turns the active paragraph into a blockquote", async (t) => {
  await withApp(t, "hello\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretInBlock(browser.cdp, "block-0");
    await press(browser.cdp, ".", { code: "Period", keyCode: 190, ctrlKey: true, shiftKey: true });
    await waitForFileText(markdownPath, /^> hello/);
    assert.equal(await readFile(markdownPath, "utf8"), "> hello\n");
  });
});

test("Ctrl+Alt+C turns the active paragraph into a fenced code block", async (t) => {
  await withApp(t, "print(1)\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretInBlock(browser.cdp, "block-0");
    await press(browser.cdp, "c", { code: "KeyC", keyCode: 67, ctrlKey: true, altKey: true });
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    await waitForFileText(markdownPath, /```\nprint\(1\)\n```/);
    assert.equal(await readFile(markdownPath, "utf8"), "```\nprint(1)\n```\n");
  });
});

test("typing ``` then Enter opens an empty fenced code block to type into", async (t) => {
  await withApp(t, "", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretInBlock(browser.cdp, "block-0");
    await insertText(browser.cdp, "```");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    await insertText(browser.cdp, "const x = 1");
    await waitForFileText(markdownPath, /```\nconst x = 1\n```/);
    const saved = await readFile(markdownPath, "utf8");
    assert.match(saved, /^```\nconst x = 1\n```/);
  });
});

test("typing --- then Enter inserts a horizontal rule with a paragraph below it", async (t) => {
  await withApp(t, "", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretInBlock(browser.cdp, "block-0");
    await insertText(browser.cdp, "---");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "!!document.querySelector('.editable-thematic-break')");
    await insertText(browser.cdp, "below");
    await waitForFileText(markdownPath, /---\n\nbelow/);
    assert.match(await readFile(markdownPath, "utf8"), /^---\n\nbelow/);
  });
});

test("a horizontal rule from the file renders and can be deleted with Backspace", async (t) => {
  await withApp(t, "above\n\n---\n\nbelow\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-thematic-break')");
    // Focus the rule (a void block) and delete it.
    await evaluate(browser.cdp, "document.querySelector('.editable-thematic-break').focus()");
    await press(browser.cdp, "Backspace", { code: "Backspace", keyCode: 8 });
    await waitFor(browser.cdp, "!document.querySelector('.editable-thematic-break')");
    await waitForFileText(markdownPath, /above\n\nbelow/);
    assert.equal(await readFile(markdownPath, "utf8"), "above\n\nbelow\n");
  });
});
