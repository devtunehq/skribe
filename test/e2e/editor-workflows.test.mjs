import assert from "node:assert/strict";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  jsonRequest,
  makeMarkdownDoc,
  mouseDrag,
  navigate,
  press,
  removeTempDir,
  seedReview,
  startSkribeServer,
  waitFor,
  waitForFilePredicate,
  waitForFileText
} from "./helpers.mjs";

async function withApp(t, markdown, callback, options = {}) {
  const browser = await browserTest(t);
  if (!browser) return;

  const { rootDir, markdownPath } = await makeMarkdownDoc(options.name ?? "draft.md", markdown);
  const server = await startSkribeServer(markdownPath);

  try {
    const baseSettings = await disableToneSetup(server.baseUrl);
    if (options.settings) {
      await jsonRequest(server.baseUrl, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: { ...baseSettings, ...options.settings } })
      });
    }
    if (options.review) await seedReview(server.baseUrl, options.review);
    await navigate(browser.cdp, server.baseUrl, options.width ?? 1440, options.height ?? 1000);
    await callback({ browser, server, markdownPath });
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
}

function selectTextInBlockExpression(blockId, text) {
  return `(() => {
    const block = document.querySelector('[data-block-id="${blockId}"]');
    if (!block) return { ok: false, reason: 'missing block' };
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
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
    block.focus();
    block.dispatchEvent(new Event('select', { bubbles: true }));
    block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: block.getBoundingClientRect().left + 20, clientY: block.getBoundingClientRect().top + 10 }));
    return { ok: true, selected: selection.toString() };
  })()`;
}

async function setEditableText(cdp, blockId, text, options = {}) {
  return evaluate(
    cdp,
    `(() => {
      const block = document.querySelector('[data-block-id="${blockId}"]');
      if (!block) return false;
      block.focus();
      block.textContent = ${JSON.stringify(text)};
      const range = document.createRange();
      const node = block.firstChild || block;
      const offset = node.nodeType === Node.TEXT_NODE ? node.textContent.length : block.childNodes.length;
      range.setStart(node, offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(options.data ?? text)} }));
      return true;
    })()`
  );
}

async function clickButtonByText(cdp, rootSelector, text) {
  return evaluate(
    cdp,
    `(() => {
      const root = document.querySelector(${JSON.stringify(rootSelector)}) || document;
      const button = Array.from(root.querySelectorAll('button')).find((candidate) => candidate.textContent.trim().includes(${JSON.stringify(text)}));
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
}

test("manual edits autosave without moving the caret, and undo/redo works", async (t) => {
  await withApp(
    t,
    "# Draft\n\nFirst paragraph.\n\nSecond paragraph.\n",
    async ({ browser, markdownPath }) => {
      assert.equal(await setEditableText(browser.cdp, "block-1", "First paragraph edited."), true);
      await waitForFileText(markdownPath, /First paragraph edited\./);

      const caret = await evaluate(
        browser.cdp,
        `(() => {
          const block = document.querySelector('[data-block-id="block-1"]');
          const selection = window.getSelection();
          return {
            active: Boolean(block && document.activeElement === block),
            text: block?.textContent || '',
            offset: selection?.focusOffset ?? -1,
            expectedOffset: block?.textContent.length ?? -2
          };
        })()`
      );

      assert.deepEqual(caret, {
        active: true,
        text: "First paragraph edited.",
        offset: "First paragraph edited.".length,
        expectedOffset: "First paragraph edited.".length
      });

      await press(browser.cdp, "2", { ctrlKey: true, altKey: true, code: "Digit2", keyCode: 50 });
      await waitFor(
        browser.cdp,
        "fetch('/api/document').then((response) => response.json()).then((doc) => doc.markdown.includes('## First paragraph edited.'))"
      );

      await evaluate(browser.cdp, "document.querySelector('[data-block-id=\"block-1\"]')?.focus()");
      await press(browser.cdp, "z", { ctrlKey: true, code: "KeyZ", keyCode: 90 });
      await waitFor(
        browser.cdp,
        "fetch('/api/document').then((response) => response.json()).then((doc) => !doc.markdown.includes('## First paragraph edited.') && doc.markdown.includes('First paragraph edited.'))"
      );

      await evaluate(browser.cdp, "document.querySelector('[data-block-id=\"block-1\"]')?.focus()");
      await press(browser.cdp, "z", { ctrlKey: true, shiftKey: true, code: "KeyZ", keyCode: 90 });
      await waitFor(
        browser.cdp,
        "fetch('/api/document').then((response) => response.json()).then((doc) => doc.markdown.includes('## First paragraph edited.'))"
      );
      assert.match(await waitForFileText(markdownPath, /## First paragraph edited\./), /## First paragraph edited\./);
    }
  );
});

test("Ctrl-A selects the whole document and copy uses rendered cross-block text", async (t) => {
  await withApp(
    t,
    "# Draft\n\nFirst paragraph.\n\nSecond paragraph with [a link](https://example.com).\n",
    async ({ browser }) => {
      await evaluate(browser.cdp, "document.querySelector('[data-block-id=\"block-1\"]')?.focus()");
      await press(browser.cdp, "a", { ctrlKey: true, code: "KeyA", keyCode: 65 });
      const copied = await evaluate(
        browser.cdp,
        `(() => {
          const canvas = document.querySelector('.markdown-canvas');
          const data = new DataTransfer();
          const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', { value: data });
          canvas.dispatchEvent(event);
          return { prevented: event.defaultPrevented, text: data.getData('text/plain') };
        })()`
      );

      assert.equal(copied.prevented, true);
      assert.equal(copied.text, "Draft\n\nFirst paragraph.\n\nSecond paragraph with a link.");
    }
  );
});

test("cross-block selections can be deleted with Backspace", async (t) => {
  await withApp(
    t,
    "# Draft\n\nAlpha first.\n\nBeta second.\n\nGamma third.\n",
    async ({ browser, markdownPath }) => {
      const points = await evaluate(
        browser.cdp,
        `(() => {
          const first = document.querySelector('[data-block-id="block-1"]').getBoundingClientRect();
          const second = document.querySelector('[data-block-id="block-2"]').getBoundingClientRect();
          return {
            from: { x: first.left + 4, y: first.top + first.height / 2 },
            to: { x: second.right - 4, y: second.top + second.height / 2 }
          };
        })()`
      );

      await mouseDrag(browser.cdp, points.from, points.to);
      await waitFor(browser.cdp, "Boolean(document.querySelector('.floating-format-toolbar'))");
      await press(browser.cdp, "Backspace", { code: "Backspace", keyCode: 8 });
      await waitFor(
        browser.cdp,
        "fetch('/api/document').then((response) => response.json()).then((doc) => !doc.markdown.includes('Alpha first') && !doc.markdown.includes('Beta second') && doc.markdown.includes('Gamma third.'))"
      );

      const saved = await waitForFilePredicate(
        markdownPath,
        (text) => !text.includes("Alpha first") && !text.includes("Beta second") && text.includes("Gamma third.")
      );
      assert.doesNotMatch(saved, /Alpha first/);
      assert.doesNotMatch(saved, /Beta second/);
      assert.match(saved, /Gamma third\./);
    }
  );
});

test("pasted Markdown renders headings, links, and tables in the editor", async (t) => {
  await withApp(t, "", async ({ browser, markdownPath }) => {
    const pasted = `# Pasted heading

[Skribe](https://example.com) renders this.

| Stage | Status |
| --- | --- |
| Draft | Ready |`;

    const result = await evaluate(
      browser.cdp,
      `(() => {
        const editable = document.querySelector('.editable-text');
        editable.focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const data = new DataTransfer();
        data.setData('text/plain', ${JSON.stringify(pasted)});
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: data });
        document.querySelector('.markdown-canvas').dispatchEvent(event);
        return event.defaultPrevented;
      })()`
    );
    assert.equal(result, true);

    await waitForFileText(markdownPath, /Pasted heading/);
    assert.equal(await evaluate(browser.cdp, "Boolean(document.querySelector('.markdown-canvas h1'))"), true);
    assert.equal(await evaluate(browser.cdp, "Boolean(document.querySelector('.editable-text a[href=\"https://example.com\"]'))"), true);
    assert.equal(await evaluate(browser.cdp, "Boolean(document.querySelector('.editable-table'))"), true);
  });
});

test("pasted image files are saved locally and rendered as image blocks", async (t) => {
  await withApp(t, "Intro.\n", async ({ browser, server, markdownPath }) => {
    const prevented = await evaluate(
      browser.cdp,
      `(() => {
        const editable = document.querySelector('.editable-text');
        editable.focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const bytes = Uint8Array.from(
          atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='),
          (character) => character.charCodeAt(0)
        );
        const data = new DataTransfer();
        data.items.add(new File([bytes], 'diagram.png', { type: 'image/png' }));
        data.items.add(new File([bytes], 'chart.png', { type: 'image/png' }));
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: data });
        document.querySelector('.markdown-canvas').dispatchEvent(event);
        return event.defaultPrevented;
      })()`
    );
    assert.equal(prevented, true);

    const saved = await waitForFileText(markdownPath, /!\[chart\]\(.*\.png\)/);
    assert.match(saved, /!\[diagram\]\(draft\.assets\/diagram-[a-f0-9]{10}\.png\)/);
    assert.match(saved, /!\[chart\]\(draft\.assets\/chart-[a-f0-9]{10}\.png\)/);
    await waitFor(browser.cdp, "document.querySelectorAll('.editable-image-block img').length === 2");

    const imageSrc = await evaluate(browser.cdp, "document.querySelector('.editable-image-block img')?.getAttribute('src') || ''");
    assert.match(imageSrc, /^\/api\/assets\?src=/);

    const assetResponse = await fetch(`${server.baseUrl}${imageSrc}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("content-type"), "image/png");

    assert.equal(await setEditableText(browser.cdp, "block-0", "Intro edited."), true);
    const edited = await waitForFileText(markdownPath, /Intro edited\./);
    assert.match(edited, /!\[diagram\]\(draft\.assets\/diagram-[a-f0-9]{10}\.png\)/);
    assert.match(edited, /!\[chart\]\(draft\.assets\/chart-[a-f0-9]{10}\.png\)/);
    assert.doesNotMatch(edited, /\/api\/assets/);
  });
});

test("insert-link popover applies a Markdown link to selected text", async (t) => {
  await withApp(
    t,
    "# Draft\n\nKeycard is worth watching.\n",
    async ({ browser, markdownPath }) => {
      const selected = await evaluate(browser.cdp, selectTextInBlockExpression("block-1", "Keycard"));
      assert.deepEqual(selected, { ok: true, selected: "Keycard" });
      await waitFor(browser.cdp, "Boolean(document.querySelector('.floating-format-toolbar'))");
      assert.equal(
        await evaluate(browser.cdp, "Boolean(document.querySelector('.floating-format-toolbar button[title=\"Insert link\"]'))"),
        true
      );
      await evaluate(browser.cdp, "document.querySelector('.floating-format-toolbar button[title=\"Insert link\"]').click()");
      await waitFor(browser.cdp, "Boolean(document.querySelector('.link-popover input'))");
      await evaluate(
        browser.cdp,
        `(() => {
          const input = document.querySelector('.link-popover input');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'keycard.ai');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.link-popover .primary-button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          return true;
        })()`
      );

      await waitForFileText(markdownPath, /\[Keycard\]\(https:\/\/keycard\.ai\)/);
      await waitFor(
        browser.cdp,
        "Array.from(document.querySelectorAll('.editable-text a')).some((anchor) => anchor.textContent === 'Keycard' && anchor.href.startsWith('https://keycard.ai'))"
      );
    }
  );
});

test("anchored threads can be created from selected text and receive stub agent replies", async (t) => {
  await withApp(
    t,
    "# Draft\n\nThis paragraph needs a sharper line.\n",
    async ({ browser }) => {
      const selected = await evaluate(browser.cdp, selectTextInBlockExpression("block-1", "sharper line"));
      assert.deepEqual(selected, { ok: true, selected: "sharper line" });
      await waitFor(browser.cdp, "Boolean(document.querySelector('.floating-format-toolbar button[title=\"Comment on selected text\"]'))");
      await evaluate(browser.cdp, "document.querySelector('.floating-format-toolbar button[title=\"Comment on selected text\"]').click()");
      await waitFor(browser.cdp, "Boolean(document.querySelector('.new-thread-box textarea'))");
      await evaluate(
        browser.cdp,
        `(() => {
          const textarea = document.querySelector('.new-thread-box textarea');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Tighten this please.');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`
      );
      assert.equal(await clickButtonByText(browser.cdp, ".new-thread-box", "Add thread"), true);
      await waitFor(
        browser.cdp,
        "fetch('/api/document').then((response) => response.json()).then((doc) => doc.review.threads[0]?.messages.length >= 2)",
        6000
      );

      const threadState = await evaluate(
        browser.cdp,
        `fetch('/api/document').then((response) => response.json()).then((doc) => ({
          threadCount: doc.review.threads.length,
          messages: doc.review.threads[0].messages.map((message) => message.author),
          hasHighlight: Boolean(document.querySelector('.anchor-highlight[data-thread-id]'))
        }))`
      );

      assert.equal(threadState.threadCount, 1);
      assert.deepEqual(threadState.messages, ["human", "agent"]);
      assert.equal(threadState.hasHighlight, true);
    }
  );
});

test("resolved threads are hidden by default and can be shown from the thread toolbar", async (t) => {
  const createdAt = "2026-06-03T12:00:00.000Z";
  await withApp(
    t,
    "# Draft\n\nOpen target.\n\nResolved target.\n",
    async ({ browser }) => {
      assert.equal(await evaluate(browser.cdp, "document.querySelectorAll('.thread-card').length"), 1);
      assert.equal(await clickButtonByText(browser.cdp, ".thread-list-toolbar", "Show resolved"), true);
      await waitFor(browser.cdp, "document.querySelectorAll('.thread-card').length === 2");
    },
    {
      review: {
        threads: [
          {
            id: "thread-open",
            status: "open",
            anchor: { exact: "Open target.", prefix: "", suffix: "", start: 9, end: 21 },
            messages: [{ id: "msg-open", author: "human", body: "Open note", createdAt }],
            suggestions: [],
            createdAt,
            updatedAt: createdAt
          },
          {
            id: "thread-resolved",
            status: "resolved",
            anchor: { exact: "Resolved target.", prefix: "", suffix: "", start: 23, end: 39 },
            messages: [{ id: "msg-resolved", author: "human", body: "Resolved note", createdAt }],
            suggestions: [],
            createdAt,
            updatedAt: createdAt
          }
        ]
      }
    }
  );
});

test("accepting an inline proposal block hides it and preserves unrelated manual edits", async (t) => {
  const originalMarkdown = "# Draft\n\nOriginal one.\n\nManual untouched.\n\nOriginal two.\n";
  const replacementMarkdown = "# Draft\n\nImproved one.\n\nManual untouched.\n\nImproved two.\n";
  await withApp(
    t,
    originalMarkdown,
    async ({ browser, markdownPath }) => {
      await waitFor(browser.cdp, "document.querySelectorAll('[data-inline-proposal-change]').length >= 2");
      assert.equal(await setEditableText(browser.cdp, "block-2", "Manual edit survives."), true);
      assert.equal(await clickButtonByText(browser.cdp, "[data-inline-proposal-change]", "Accept"), true);
      await waitForFileText(markdownPath, /Improved one\./);

      const saved = await waitForFileText(markdownPath, /Manual edit survives\./);
      assert.match(saved, /Improved one\./);
      assert.match(saved, /Manual edit survives\./);
      assert.match(saved, /Original two\./);
      assert.doesNotMatch(saved, /Original one\./);
      assert.equal(await evaluate(browser.cdp, "document.querySelectorAll('[data-inline-proposal-change]').length"), 1);
    },
    {
      review: {
        proposals: [
          {
            id: "proposal-e2e",
            source: "chat",
            threadId: null,
            title: "Inline proposal E2E",
            summary: "Tests inline proposal application.",
            originalMarkdown,
            replacementMarkdown,
            status: "open",
            changeDecisions: {},
            author: "agent",
            createdAt: "2026-06-03T12:00:00.000Z"
          }
        ]
      }
    }
  );
});

test("unified diff setting renders inline proposal blocks as unified lines", async (t) => {
  const originalMarkdown = "# Draft\n\nOriginal one.\n\nOriginal two.\n";
  const replacementMarkdown = "# Draft\n\nImproved one.\n\nOriginal two.\n";
  await withApp(
    t,
    originalMarkdown,
    async ({ browser }) => {
      await waitFor(browser.cdp, "Boolean(document.querySelector('.proposal-change-preview.is-unified'))");
      const preview = await evaluate(
        browser.cdp,
        `(() => ({
          splitCount: document.querySelectorAll('.proposal-change-preview.is-split').length,
          deleteText: document.querySelector('.proposal-unified-line.is-delete code')?.textContent ?? '',
          addText: document.querySelector('.proposal-unified-line.is-add code')?.textContent ?? ''
        }))()`
      );
      assert.equal(preview.splitCount, 0);
      assert.equal(preview.deleteText, "Original one.");
      assert.equal(preview.addText, "Improved one.");
    },
    {
      settings: { diffViewMode: "unified" },
      review: {
        proposals: [
          {
            id: "proposal-unified-e2e",
            source: "chat",
            threadId: null,
            title: "Unified proposal E2E",
            summary: "Tests unified proposal rendering.",
            originalMarkdown,
            replacementMarkdown,
            status: "open",
            changeDecisions: {},
            author: "agent",
            createdAt: "2026-06-03T12:00:00.000Z"
          }
        ]
      }
    }
  );
});

test("table image export uses a transparent PNG background", async (t) => {
  await withApp(
    t,
    "# Draft\n\n| Stage | Status |\n| --- | --- |\n| Draft | Ready |\n",
    async ({ browser }) => {
      await waitFor(browser.cdp, "Boolean(document.querySelector('.editable-table'))");
      await evaluate(
        browser.cdp,
        `(() => {
          window.__skribeTableExport = null;
          const originalToBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
            const ctx = this.getContext('2d');
            const pixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
            window.__skribeTableExport = { width: this.width, height: this.height, pixel, type };
            return originalToBlob.call(this, callback, type, quality);
          };
          const originalCreateObjectURL = URL.createObjectURL;
          URL.createObjectURL = function(blob) {
            window.__skribeTableBlobType = blob.type;
            return originalCreateObjectURL.call(this, blob);
          };
          return true;
        })()`
      );
      await evaluate(browser.cdp, "document.querySelector('.table-image-download').click()");
      await waitFor(browser.cdp, "Boolean(window.__skribeTableExport && window.__skribeTableBlobType)");
      const exportInfo = await evaluate(browser.cdp, "({ ...window.__skribeTableExport, blobType: window.__skribeTableBlobType })");

      assert.ok(exportInfo.width > 0);
      assert.ok(exportInfo.height > 0);
      assert.equal(exportInfo.pixel[3], 0);
      assert.equal(exportInfo.type, "image/png");
      assert.equal(exportInfo.blobType, "image/png");
    }
  );
});

test("settings dialog persists language, theme, font, and collapsed panel defaults", async (t) => {
  await withApp(
    t,
    "# Draft\n\nSettings test.\n",
    async ({ browser, server }) => {
      await evaluate(browser.cdp, "document.querySelector('button[title=\"Settings\"]').click()");
      await waitFor(browser.cdp, "Boolean(document.querySelector('.settings-dialog'))");
      const selectLayout = await evaluate(
        browser.cdp,
        `(() => {
          const field = (label) => Array.from(document.querySelectorAll('.settings-field')).find((candidate) => candidate.textContent.includes(label));
          const language = field('Language')?.querySelector('select')?.getBoundingClientRect();
          const font = field('Document font')?.querySelector('select')?.getBoundingClientRect();
          return {
            topDelta: language && font ? Math.abs(language.top - font.top) : 999,
            heightDelta: language && font ? Math.abs(language.height - font.height) : 999
          };
        })()`
      );
      assert.ok(selectLayout.topDelta <= 1, `select tops differ by ${selectLayout.topDelta}px`);
      assert.ok(selectLayout.heightDelta <= 1, `select heights differ by ${selectLayout.heightDelta}px`);
      await evaluate(
        browser.cdp,
        `(() => {
          const language = Array.from(document.querySelectorAll('.settings-field')).find((field) => field.textContent.includes('Language')).querySelector('select');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(language, 'en-US');
          language.querySelector('option[value="en-US"]').selected = true;
          language.dispatchEvent(new Event('input', { bubbles: true }));
          language.dispatchEvent(new Event('change', { bubbles: true }));
          const font = Array.from(document.querySelectorAll('.settings-field')).find((field) => field.textContent.includes('Document font')).querySelector('select');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(font, 'serif');
          font.querySelector('option[value="serif"]').selected = true;
          font.dispatchEvent(new Event('input', { bubbles: true }));
          font.dispatchEvent(new Event('change', { bubbles: true }));
          const theme = Array.from(document.querySelectorAll('.settings-field')).find((field) => field.textContent.includes('Theme')).querySelector('select');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(theme, 'sage');
          theme.querySelector('option[value="sage"]').selected = true;
          theme.dispatchEvent(new Event('input', { bubbles: true }));
          theme.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`
      );
      await evaluate(browser.cdp, "document.querySelector('#settings-tab-agent').click()");
      await waitFor(browser.cdp, "document.querySelector('#settings-tab-agent')?.getAttribute('aria-selected') === 'true'");
      await evaluate(
        browser.cdp,
        `(() => {
          const diffView = Array.from(document.querySelectorAll('.settings-field')).find((field) => field.textContent.includes('Diff view')).querySelector('select');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(diffView, 'unified');
          diffView.querySelector('option[value="unified"]').selected = true;
          diffView.dispatchEvent(new Event('input', { bubbles: true }));
          diffView.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`
      );
      await evaluate(browser.cdp, "document.querySelector('#settings-tab-workspace').click()");
      await waitFor(browser.cdp, "document.querySelector('#settings-tab-workspace')?.getAttribute('aria-selected') === 'true'");
      await evaluate(
        browser.cdp,
        `(() => {
          const left = Array.from(document.querySelectorAll('.settings-check')).find((field) => field.textContent.includes('Collapse left panel')).querySelector('input');
          const right = Array.from(document.querySelectorAll('.settings-check')).find((field) => field.textContent.includes('Collapse right panel')).querySelector('input');
          if (!left.checked) left.click();
          if (!right.checked) right.click();
          return true;
        })()`
      );
      assert.equal(await clickButtonByText(browser.cdp, ".settings-dialog-actions", "Save"), true);
      await waitFor(
        browser.cdp,
        "fetch('/api/settings').then((response) => response.json()).then((payload) => payload.settings.editorLanguage === 'en-US' && payload.settings.diffViewMode === 'unified')"
      );
      await waitFor(browser.cdp, "document.querySelector('.app-shell')?.getAttribute('lang') === 'en-US'");
      await waitFor(browser.cdp, "document.querySelector('.app-shell')?.dataset.documentFont === 'serif'");
      await waitFor(browser.cdp, "document.querySelector('.app-shell')?.dataset.theme === 'sage'");
      assert.equal(await evaluate(browser.cdp, "document.querySelector('.app-shell').classList.contains('left-collapsed')"), true);
      assert.equal(await evaluate(browser.cdp, "document.querySelector('.app-shell').classList.contains('right-collapsed')"), true);
      assert.match(
        await evaluate(browser.cdp, "getComputedStyle(document.querySelector('.markdown-canvas p')).fontFamily"),
        /Georgia|Iowan|Palatino/i
      );

      await navigate(browser.cdp, `${server.baseUrl}/?settingsReload=${Date.now()}`);
      await waitFor(browser.cdp, "document.querySelector('.app-shell')?.getAttribute('lang') === 'en-US'");
      await waitFor(browser.cdp, "document.querySelector('.app-shell')?.dataset.documentFont === 'serif'");
      await waitFor(browser.cdp, "document.querySelector('.app-shell')?.dataset.theme === 'sage'");
      assert.equal(await evaluate(browser.cdp, "document.querySelector('.app-shell').classList.contains('left-collapsed')"), true);
      assert.equal(await evaluate(browser.cdp, "document.querySelector('.app-shell').classList.contains('right-collapsed')"), true);
    }
  );
});
