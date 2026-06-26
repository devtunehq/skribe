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
  await withApp(t, "- First item\n", async ({ browser }) => {
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

    // Immediately — before typing or blurring — there must be a second, empty
    // list row, and the caret must be inside it (not a soft break in the first).
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-list-row').length === 2");
    const afterEnter = await evaluate(
      browser.cdp,
      `(() => {
        const rows = document.querySelectorAll('.editable-list-row');
        const second = rows[1]?.querySelector('[data-block-id]');
        return {
          secondText: second?.textContent ?? null,
          caretInSecond: Boolean(second && second.contains(document.activeElement) || second === document.activeElement)
        };
      })()`
    );
    assert.equal(afterEnter.secondText, "", "second list item should start empty");
    assert.equal(afterEnter.caretInSecond, true, "caret should move into the new list item");

    // Both rows are list items, not a paragraph carrying the second line (the bug).
    assert.equal(
      await evaluate(
        browser.cdp,
        "Array.from(document.querySelectorAll('.editable-document p')).some((p) => p.closest('.editable-list-row') === null && p.textContent.trim() !== '')"
      ),
      false,
      "no stray paragraph should be created"
    );

    // The empty new item survives the post-commit save (it isn't dropped while the
    // caret is in it), so the writer can fill it in.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await evaluate(browser.cdp, "document.querySelectorAll('.editable-list-row').length"), 2);
    // Note: the markdown round-trip of typed content is covered deterministically
    // by the "splitting a list item serializes into two sibling items" unit test;
    // headless Chromium can't reliably type into an empty contentEditable, so we
    // don't assert that round-trip here.
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
