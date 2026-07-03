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

test("a bare ``` fence left to auto-save still closes cleanly on Enter (no swallow)", async (t) => {
  // Regression: if the 1200ms live-save debounce fires while a bare ``` line sits
  // in a paragraph, the model reparses it into an unclosed fence. Pressing Enter
  // must still convert it to a closed, empty code block without eating "keep".
  await withApp(t, "​\n\nkeep\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-document [data-block-id]').length === 2");
    await caretInBlock(browser.cdp, "block-0");
    await insertText(browser.cdp, "```");
    await new Promise((resolve) => setTimeout(resolve, 1400)); // past the live-save debounce
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    // Type into the new code block so it persists, then confirm "keep" stayed a
    // separate block after a *closed* fence rather than being swallowed.
    await insertText(browser.cdp, "code");
    await waitForFileText(markdownPath, /```[\s\S]*?code[\s\S]*?```/);
    const saved = await readFile(markdownPath, "utf8");
    assert.match(saved, /```[\s\S]*?code[\s\S]*?```[\s\S]*keep/);
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
    await waitFor(browser.cdp, "!!document.querySelector('button[title=\"Insert table\"]') && !document.querySelector('button[title=\"Insert table\"]').disabled");
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

// --- Backfill: affordances that shipped without their own e2e coverage ---

async function selectBlockText(cdp, blockId) {
  return evaluate(
    cdp,
    `(() => {
      const b = document.querySelector('[data-block-id="${blockId}"]');
      b.focus();
      const r = document.createRange();
      r.selectNodeContents(b);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    })()`
  );
}

async function focusBlockByClick(cdp, blockId) {
  const point = await evaluate(
    cdp,
    `(() => {
      const b = document.querySelector('[data-block-id="${blockId}"]');
      const r = b.getBoundingClientRect();
      return { x: r.left + 4, y: r.top + r.height / 2 };
    })()`
  );
  await mouseClick(cdp, point);
}

// Toolbar buttons act on mousedown, so drive them with a real CDP click (which
// fires mousedown), not a programmatic .click().
async function clickToolbarButton(cdp, selector) {
  const point = await evaluate(
    cdp,
    `(() => {
      const b = document.querySelector('${selector}');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
  );
  assert.ok(point, `toolbar button not found: ${selector}`);
  await mouseClick(cdp, point);
}

test("Ctrl+Shift+X strikes through the selection", async (t) => {
  await withApp(t, "strike me\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await selectBlockText(browser.cdp, "block-0");
    await press(browser.cdp, "x", { code: "KeyX", keyCode: 88, ctrlKey: true, shiftKey: true });
    await waitForFileText(markdownPath, /~~strike me~~/);
  });
});

test("the strikethrough toolbar button strikes the selection", async (t) => {
  await withApp(t, "cross out\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await selectBlockText(browser.cdp, "block-0");
    await clickToolbarButton(browser.cdp, '.format-toolbar button[title^="Strikethrough"]');
    await waitForFileText(markdownPath, /~~cross out~~/);
  });
});

test("the code-block toolbar button converts the active block", async (t) => {
  await withApp(t, "printf\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await focusBlockByClick(browser.cdp, "block-0");
    await waitFor(browser.cdp, "!!document.querySelector('button[title^=\"Code block\"]') && !document.querySelector('button[title^=\"Code block\"]').disabled");
    await clickToolbarButton(browser.cdp, 'button[title^="Code block"]');
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    await waitForFileText(markdownPath, /```\nprintf\n```/);
  });
});

test("the horizontal-rule toolbar button inserts a rule", async (t) => {
  await withApp(t, "intro\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await focusBlockByClick(browser.cdp, "block-0");
    await waitFor(browser.cdp, "!!document.querySelector('button[title=\"Horizontal rule\"]') && !document.querySelector('button[title=\"Horizontal rule\"]').disabled");
    await clickToolbarButton(browser.cdp, 'button[title="Horizontal rule"]');
    await waitFor(browser.cdp, "!!document.querySelector('.editable-thematic-break')");
    await waitForFileText(markdownPath, /intro\n\n---/);
  });
});

// --- Regressions: empty code block robustness (reported "removeChild" crash) ---

test("an empty code block survives the live-save debounce (does not vanish)", async (t) => {
  await withApp(t, "", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('[data-block-id=\"block-0\"]')");
    await caretInBlock(browser.cdp, "block-0");
    await insertText(browser.cdp, "```");
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    await new Promise((r) => setTimeout(r, 1500)); // past the 1200ms live-save debounce
    assert.ok(
      await evaluate(browser.cdp, "!!document.querySelector('.editable-code')"),
      "empty code block vanished after the live-save"
    );
    await waitForFileText(markdownPath, /```/);
    // The preserved empty block must not smuggle a hidden sentinel between the
    // fences — it round-trips as a genuinely empty fenced block.
    assert.doesNotMatch(await readFile(markdownPath, "utf8"), /​/, "sentinel persisted inside the code fence");
  });
});

test("converting an empty code block to a quote keeps it and does not hijack the next block", async (t) => {
  await withApp(t, "```\n\n```\n\nafter\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    await evaluate(
      browser.cdp,
      "window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message)));"
    );
    // Focus the empty code block with a real click, then convert via the toolbar.
    await clickToolbarButton(browser.cdp, ".editable-code code");
    await waitFor(browser.cdp, "!!document.querySelector('button[title=\"Quote\"]') && !document.querySelector('button[title=\"Quote\"]').disabled");
    await clickToolbarButton(browser.cdp, 'button[title="Quote"]');
    await new Promise((r) => setTimeout(r, 700));
    const saved = await readFile(markdownPath, "utf8");
    // The following paragraph must not be pulled into a quote (it used to be, when
    // the empty code block got dropped and everything shifted up).
    assert.doesNotMatch(saved, /> after/, '"after" was hijacked into a quote');
    assert.match(saved, /after/, '"after" was lost');
    assert.equal(
      (await evaluate(browser.cdp, "window.__errs || []")).filter((e) => /removeChild/.test(e)).length,
      0,
      "removeChild error thrown during conversion"
    );
  });
});

test("a quote block is styled distinctly from a code block (accent bar, not a box)", async (t) => {
  await withApp(t, "> a quote\n\n```\ncode\n```\n", async ({ browser }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-quote') && !!document.querySelector('.editable-code')");
    const style = await evaluate(
      browser.cdp,
      `(() => {
        const q = getComputedStyle(document.querySelector('.editable-quote'));
        const c = getComputedStyle(document.querySelector('.editable-code'));
        const qtext = getComputedStyle(document.querySelector('.editable-quote .editable-text'));
        return {
          quoteBorderLeft: parseFloat(q.borderLeftWidth),
          quoteBorderTop: parseFloat(q.borderTopWidth),
          quoteBg: q.backgroundColor,
          codeBg: c.backgroundColor,
          quoteItalic: qtext.fontStyle
        };
      })()`
    );
    // Accent bar: a thick left border, no top border.
    assert.ok(style.quoteBorderLeft >= 3, `quote left border too thin (${style.quoteBorderLeft})`);
    assert.equal(style.quoteBorderTop, 0, "quote should not have a full box border");
    // Not the recessed code box: transparent background, unlike the code block.
    assert.match(style.quoteBg, /rgba\(0, 0, 0, 0\)|transparent/, "quote should have no box background");
    assert.notEqual(style.quoteBg, style.codeBg);
    assert.equal(style.quoteItalic, "italic");
  });
});

test("code content with HTML-like text renders literally (no injection) and round-trips", async (t) => {
  // dangerouslySetInnerHTML must escape, so `<b>`/`<script>` are shown as text, not
  // injected as elements, and the markdown file keeps the raw characters.
  const md = "```\n<b>x</b> & <script>y</script>\n```\n";
  await withApp(t, md, async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    assert.equal(
      await evaluate(browser.cdp, "document.querySelectorAll('.editable-code code b, .editable-code code script').length"),
      0,
      "HTML in code was injected as real elements"
    );
    assert.match(
      await evaluate(browser.cdp, "document.querySelector('.editable-code code').textContent"),
      /<b>x<\/b> & <script>y<\/script>/
    );
    assert.equal(await readFile(markdownPath, "utf8"), md); // file keeps raw characters
  });
});

test("converting a code block with content to a quote does not throw (removeChild regression)", async (t) => {
  await withApp(t, "```js\nconst a = 1;\nconst b = 2;\n```\n\nafter\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "!!document.querySelector('.editable-code')");
    await evaluate(
      browser.cdp,
      "window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message)));"
    );
    await clickToolbarButton(browser.cdp, ".editable-code code");
    await waitFor(browser.cdp, "!!document.querySelector('button[title=\"Quote\"]') && !document.querySelector('button[title=\"Quote\"]').disabled");
    await clickToolbarButton(browser.cdp, 'button[title="Quote"]');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(
      (await evaluate(browser.cdp, "window.__errs || []")).filter((e) => /removeChild|not a child/.test(e)).length,
      0
    );
    // The code content became a quote; "after" is untouched.
    const saved = await readFile(markdownPath, "utf8");
    assert.doesNotMatch(saved, /```/, "block should no longer be code");
    assert.match(saved, /after/);
  });
});
