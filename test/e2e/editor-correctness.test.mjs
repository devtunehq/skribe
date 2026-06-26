import assert from "node:assert/strict";
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
  seedReview,
  startSkribeServer,
  waitFor,
  waitForFileText
} from "./helpers.mjs";

async function withApp(t, markdown, callback, options = {}) {
  const browser = await browserTest(t);
  if (!browser) return;

  const { rootDir, markdownPath } = await makeMarkdownDoc("draft.md", markdown);
  const server = await startSkribeServer(markdownPath);

  try {
    await disableToneSetup(server.baseUrl);
    if (options.review) await seedReview(server.baseUrl, options.review);
    await navigate(browser.cdp, server.baseUrl);
    await callback({ browser, server, markdownPath });
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
}

function listMarkers(cdp) {
  return evaluate(
    cdp,
    "Array.from(document.querySelectorAll('.editable-list-marker')).map((marker) => marker.textContent)"
  );
}

test("ordered list markers render sequentially regardless of stored numbers", async (t) => {
  await withApp(t, "1. Alpha\n1. Beta\n1. Gamma\n", async ({ browser }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-marker').length === 3");
    assert.deepEqual(await listMarkers(browser.cdp), ["1.", "2.", "3."]);
  });
});

test("deleting an ordered list item renumbers the remaining items", async (t) => {
  await withApp(t, "1. Alpha\n2. Beta\n3. Gamma\n", async ({ browser }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-marker').length === 3");
    assert.deepEqual(await listMarkers(browser.cdp), ["1.", "2.", "3."]);

    // Delete the first item (block-0) via its control.
    const clicked = await evaluate(
      browser.cdp,
      `(() => {
        const shell = document.querySelector('[data-block-shell="block-0"]');
        const button = shell?.querySelector('.block-delete-button');
        if (!button) return false;
        button.click();
        return true;
      })()`
    );
    assert.equal(clicked, true);

    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-marker').length === 2");
    assert.deepEqual(await listMarkers(browser.cdp), ["1.", "2."]);
  });
});

test("pressing Enter in a list item creates a sibling item, not a paragraph", async (t) => {
  await withApp(t, "- First item\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 1");

    // Place the caret at the end of the list item and press Enter, then type.
    await evaluate(
      browser.cdp,
      `(() => {
        const block = document.querySelector('[data-block-id="block-0"]');
        block.focus();
        const range = document.createRange();
        range.selectNodeContents(block);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      })()`
    );
    await press(browser.cdp, "Enter", { code: "Enter", keyCode: 13 });
    await insertText(browser.cdp, "Second item");

    // Both lines must round-trip as list items — the bug turned the second line
    // into a detached paragraph (blank line, no marker).
    const saved = await waitForFileText(markdownPath, /Second item/);
    assert.match(saved, /- First item\n- Second item/);
    assert.doesNotMatch(saved, /- First item\n\nSecond item/);

    // After blurring (which reparses and re-renders the canvas) the user must see
    // two list rows and no paragraph carrying the second line.
    await evaluate(browser.cdp, "document.querySelector('[data-block-id=\"block-0\"]')?.blur()");
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 2");
    assert.equal(
      await evaluate(
        browser.cdp,
        "Array.from(document.querySelectorAll('.editable-document p')).some((p) => p.textContent.includes('Second item'))"
      ),
      false
    );
  });
});

test("editing a code block preserves blank lines and trailing whitespace", async (t) => {
  await withApp(t, "# Draft\n\n```js\noriginal\n```\n", async ({ browser, markdownPath }) => {
    await waitFor(browser.cdp, "Boolean(document.querySelector('.editable-code [data-block-id=\"block-1\"]'))");

    // Rewrite the code block the way contentEditable structures multi-line edits
    // (<br> line breaks), with two blank lines in the middle and a trailing blank
    // line, then notify React so the live-edit serializer runs.
    await evaluate(
      browser.cdp,
      `(() => {
        const code = document.querySelector('.editable-code [data-block-id="block-1"]');
        code.focus();
        code.innerHTML = '';
        const append = (value) => code.appendChild(document.createTextNode(value));
        const br = () => code.appendChild(document.createElement('br'));
        append('line1'); br(); br(); br(); append('line2'); br(); br();
        code.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'line2' }));
        return true;
      })()`
    );

    // The fenced code must keep all three newlines between the lines and the
    // trailing blank line; the generic serializer collapsed runs of \n and
    // trimmed the end.
    const saved = await waitForFileText(markdownPath, /line1\n\n\nline2/);
    assert.match(saved, /```js\nline1\n\n\nline2\n\n\n```/);
  });
});

test("text under a comment anchor can receive a caret and be edited", async (t) => {
  const createdAt = "2026-06-03T12:00:00.000Z";
  await withApp(
    t,
    "# Draft\n\nThis is a commented phrase here.\n",
    async ({ browser, markdownPath }) => {
      await waitFor(browser.cdp, "Boolean(document.querySelector('.anchor-highlight[data-thread-id]'))");

      // A <button> highlight is atomic inside contentEditable and rejects the
      // caret; the fix renders an editable <span>.
      assert.equal(
        await evaluate(browser.cdp, "document.querySelector('.anchor-highlight')?.tagName"),
        "SPAN"
      );

      // Place the caret inside the highlighted text (after "commented") and type.
      const placed = await evaluate(
        browser.cdp,
        `(() => {
          const block = document.querySelector('[data-block-id="block-1"]');
          const highlight = block.querySelector('.anchor-highlight');
          const walker = document.createTreeWalker(highlight, NodeFilter.SHOW_TEXT);
          const node = walker.nextNode();
          if (!node) return { ok: false };
          const offset = node.textContent.indexOf('commented') + 'commented'.length;
          block.focus();
          const range = document.createRange();
          range.setStart(node, offset);
          range.collapse(true);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return {
            ok: true,
            inside: highlight.contains(selection.anchorNode),
            collapsed: selection.isCollapsed
          };
        })()`
      );
      assert.deepEqual(placed, { ok: true, inside: true, collapsed: true });

      await insertText(browser.cdp, "X");
      const saved = await waitForFileText(markdownPath, /commentedX phrase/);
      assert.match(saved, /This is a commentedX phrase here\./);
    },
    {
      review: {
        threads: [
          {
            id: "thread-edit",
            status: "open",
            anchor: { kind: "text", exact: "commented phrase", prefix: "", suffix: "", start: 0, end: 0 },
            messages: [{ id: "msg-edit", author: "human", body: "Tighten this.", createdAt }],
            suggestions: [],
            createdAt,
            updatedAt: createdAt
          }
        ]
      }
    }
  );
});
