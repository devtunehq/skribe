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

// These exercise the "edit doesn't show until you click elsewhere" class of
// bugs: structural commits (paste, delete, shape change) must force the live
// contentEditable blocks to repaint instead of leaving stale DOM behind.
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

function placeCaretAtEnd(cdp, blockId) {
  return evaluate(
    cdp,
    `(() => {
      const block = document.querySelector('[data-block-id="${blockId}"]');
      if (!block) return false;
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
}

// Real browsers replace/split the text nodes inside a contentEditable as you
// type, detaching the exact DOM node React holds a reference to in its fiber.
// After that, React's text updates write to the now-detached node and never
// reach the screen — which is why structural edits (paste/delete) looked stale
// until a click forced a full remount. Reproduce that divergence deterministically
// by swapping a block's text node for an equivalent fresh one, out of React's
// knowledge. CDP's insertText keeps a single clean text node, so without this the
// scripted scenario never exercises the bug.
function divergeBlockTextNode(cdp, blockId) {
  return evaluate(
    cdp,
    `(() => {
      const block = document.querySelector('[data-block-id="${blockId}"]');
      if (!block) return false;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!node) return false;
      node.parentNode.replaceChild(document.createTextNode(node.textContent), node);
      return true;
    })()`
  );
}

function dispatchMarkdownPaste(cdp, text) {
  return evaluate(
    cdp,
    `(() => {
      const data = new DataTransfer();
      data.setData('text/plain', ${JSON.stringify(text)});
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      document.querySelector('.markdown-canvas').dispatchEvent(event);
      return event.defaultPrevented;
    })()`
  );
}

function editableDocumentText(cdp) {
  return evaluate(cdp, "document.querySelector('.editable-document')?.innerText || ''");
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("pasting into a populated paragraph renders the new blocks without clicking away", async (t) => {
  await withApp(
    t,
    "# Draft\n\nFirst paragraph.\n\nLast paragraph.\n",
    async ({ browser, markdownPath }) => {
      assert.equal(await placeCaretAtEnd(browser.cdp, "block-1"), true);
      // Detach the trailing block's text node so it will be reused, post-paste,
      // for different content while React's fiber points at a stale node.
      assert.equal(await divergeBlockTextNode(browser.cdp, "block-2"), true);
      assert.equal(await dispatchMarkdownPaste(browser.cdp, "Inserted one.\n\nInserted two."), true);

      // The saved markdown confirms the model updated...
      await waitForFileText(markdownPath, /Inserted two\./);

      // ...and the live editor must show the pasted blocks immediately, with no
      // intervening click. On the stale-DOM bug the reused blocks keep their old
      // text, so "Inserted one." never appears and "Last paragraph." duplicates.
      await waitFor(
        browser.cdp,
        "(document.querySelector('.editable-document')?.innerText || '').includes('Inserted one.')"
      );

      const text = await editableDocumentText(browser.cdp);
      assert.equal(countOccurrences(text, "Inserted one."), 1, `pasted block missing/duplicated: ${JSON.stringify(text)}`);
      assert.equal(countOccurrences(text, "Inserted two."), 1, `pasted block missing/duplicated: ${JSON.stringify(text)}`);
      assert.equal(countOccurrences(text, "First paragraph."), 1, `original block lost/duplicated: ${JSON.stringify(text)}`);
      assert.equal(countOccurrences(text, "Last paragraph."), 1, `trailing block lost/duplicated: ${JSON.stringify(text)}`);
    }
  );
});

test("deleting a middle block removes its content immediately, not just its slot", async (t) => {
  await withApp(
    t,
    "# Draft\n\nAlpha block.\n\nBeta block.\n\nGamma block.\n",
    async ({ browser }) => {
      // Detach text nodes on the blocks that will be reused (shifted up) after the
      // delete, so React's fibers point at stale nodes — the real-world condition.
      assert.equal(await divergeBlockTextNode(browser.cdp, "block-2"), true);
      assert.equal(await divergeBlockTextNode(browser.cdp, "block-3"), true);

      // Delete the first paragraph (block-1 = "Alpha block.") via its control, so
      // every later block shifts up into a reused (diverged) node.
      const clicked = await evaluate(
        browser.cdp,
        `(() => {
          const shell = document.querySelector('[data-block-shell="block-1"]');
          const button = shell?.querySelector('.block-delete-button');
          if (!button) return false;
          button.click();
          return true;
        })()`
      );
      assert.equal(clicked, true);

      await waitFor(
        browser.cdp,
        "fetch('/api/document').then((response) => response.json()).then((doc) => !doc.markdown.includes('Alpha block.') && doc.markdown.includes('Gamma block.'))"
      );

      // The live editor must drop "Alpha block." right away and repaint the
      // shifted-up siblings; the bug left the deleted text rendered in a reused
      // node, and the diverged siblings stale, until the next click.
      await waitFor(
        browser.cdp,
        "!(document.querySelector('.editable-document')?.innerText || '').includes('Alpha block.')"
      );

      const text = await editableDocumentText(browser.cdp);
      assert.equal(countOccurrences(text, "Alpha block."), 0, `deleted block still rendered: ${JSON.stringify(text)}`);
      assert.equal(countOccurrences(text, "Beta block."), 1, `sibling lost/duplicated: ${JSON.stringify(text)}`);
      assert.equal(countOccurrences(text, "Gamma block."), 1, `sibling lost/duplicated: ${JSON.stringify(text)}`);
    }
  );
});

test("a heading converted to a paragraph stays a paragraph after the live-edit debounce", async (t) => {
  await withApp(
    t,
    "# Draft\n\n## Heading line\n\nBody paragraph.\n",
    async ({ browser, markdownPath }) => {
      // Type into the heading to arm the 1200ms live-edit debounce, then convert
      // the block to a plain paragraph with Ctrl+Alt+0.
      await placeCaretAtEnd(browser.cdp, "block-1");
      await evaluate(
        browser.cdp,
        `(() => {
          const block = document.querySelector('[data-block-id="block-1"]');
          block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '!' }));
          return true;
        })()`
      );
      await press(browser.cdp, "0", { ctrlKey: true, altKey: true, code: "Digit0", keyCode: 48 });

      // Immediately it should be a paragraph.
      await waitFor(
        browser.cdp,
        "document.querySelector('[data-block-id=\"block-1\"]')?.tagName === 'P'"
      );

      // Wait past the debounce window: the stale timer must NOT resurrect the
      // heading by re-serializing the old block type.
      await new Promise((resolve) => setTimeout(resolve, 1600));

      const stillParagraph = await evaluate(
        browser.cdp,
        "document.querySelector('[data-block-id=\"block-1\"]')?.tagName === 'P'"
      );
      assert.equal(stillParagraph, true, "block reverted to a heading in the DOM");

      const saved = await readFile(markdownPath, "utf8");
      assert.doesNotMatch(saved, /^##\s/m, `heading prefix reappeared in saved markdown: ${JSON.stringify(saved)}`);
    }
  );
});
