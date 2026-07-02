import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  insertText,
  makeMarkdownDoc,
  mouseClick,
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

test("typing '[ ] ' at the start of a paragraph makes a task-list item", async (t) => {
  await withApp(t, "buy milk\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretAtStart(browser.cdp, "block-0");
    await insertText(browser.cdp, "[ ]");
    await press(browser.cdp, " ", { code: "Space", keyCode: 32 });
    await waitFor(browser.cdp, "!!document.querySelector('.editable-task-checkbox')");
    await waitForFileText(markdownPath, /^- \[ \] buy milk/);
    assert.equal(await readFile(markdownPath, "utf8"), "- [ ] buy milk\n");
  });
});

test("clicking a task checkbox toggles it in the file", async (t) => {
  await withApp(t, "- [ ] ship it\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-task-checkbox')");
    await evaluate(browser.cdp, "document.querySelector('.editable-task-checkbox').click()");
    await waitForFileText(markdownPath, /^- \[x\] ship it/);
    assert.equal(await readFile(markdownPath, "utf8"), "- [x] ship it\n");
    // Toggling back returns it to unchecked.
    await evaluate(browser.cdp, "document.querySelector('.editable-task-checkbox').click()");
    await waitForFileText(markdownPath, /^- \[ \] ship it/);
    assert.equal(await readFile(markdownPath, "utf8"), "- [ ] ship it\n");
  });
});

test("an autolink renders as a link showing the URL without the angle brackets", async (t) => {
  await withApp(t, "see <https://example.com> now\n", async ({ browser }) => {
    await waitFor(
      browser.cdp,
      "document.querySelector('.editable-document a')?.getAttribute('href') === 'https://example.com'"
    );
    await waitFor(
      browser.cdp,
      "document.querySelector('.editable-document a')?.textContent === 'https://example.com'"
    );
  });
});

test("an inline image renders inside a paragraph and round-trips its markdown src", async (t) => {
  await withApp(t, "hello ![pic](https://x.co/a.png) world\n", async ({ browser, markdownPath }) => {
    await waitFor(
      browser.cdp,
      "document.querySelector('.editable-document img.inline-image')?.getAttribute('data-md-src') === 'https://x.co/a.png'"
    );
    // The paragraph stays editable text around the image (not a block image).
    await waitFor(browser.cdp, "!!document.querySelector('.editable-document p .inline-image')");
    // Editing the paragraph re-serializes the DOM; the image markdown must survive
    // via data-md-src rather than the preview src.
    await evaluate(
      browser.cdp,
      `(() => {
        const p = document.querySelector('.editable-document p');
        p.focus();
        const r = document.createRange();
        r.selectNodeContents(p);
        r.collapse(false);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return true;
      })()`
    );
    await insertText(browser.cdp, "!");
    await waitForFileText(markdownPath, /hello !\[pic\]\(https:\/\/x\.co\/a\.png\) world!/);
  });
});

test("the toolbar inserts a starter table after the active block", async (t) => {
  await withApp(t, "intro\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    // A real click sets the active block (onMouseUp), which enables the button.
    const blockPoint = await evaluate(
      browser.cdp,
      `(() => {
        const b = document.querySelector('[data-block-id="block-0"]');
        const r = b.getBoundingClientRect();
        return { x: r.left + 4, y: r.top + r.height / 2 };
      })()`
    );
    await mouseClick(browser.cdp, blockPoint);
    await waitFor(browser.cdp, "!document.querySelector('button[title=\"Insert table\"]')?.disabled");
    const point = await evaluate(
      browser.cdp,
      `(() => {
        const b = document.querySelector('button[title="Insert table"]');
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`
    );
    await mouseClick(browser.cdp, point);
    await waitFor(browser.cdp, "!!document.querySelector('.editable-document table')");
    await waitForFileText(markdownPath, /\| Column 1 \| Column 2 \|/);
    const saved = await readFile(markdownPath, "utf8");
    assert.match(saved, /intro\n\n\| Column 1 \| Column 2 \|/);
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
