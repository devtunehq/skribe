import assert from "node:assert/strict";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  insertText,
  makeMarkdownDoc,
  navigate,
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
