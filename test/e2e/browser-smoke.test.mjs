import assert from "node:assert/strict";
import test from "node:test";

import {
  browserTest,
  disableToneSetup,
  evaluate,
  makeMarkdownDoc,
  navigate,
  removeTempDir,
  startSkribeServer,
  waitFor,
  waitForFileText
} from "./helpers.mjs";

test("browser editor smoke: empty document can be typed, autosaved, and reloaded", async (t) => {
  const browser = await browserTest(t);
  if (!browser) return;

  const { rootDir, markdownPath } = await makeMarkdownDoc("empty.md", "");
  const server = await startSkribeServer(markdownPath);

  try {
    await disableToneSetup(server.baseUrl);
    await navigate(browser.cdp, server.baseUrl);
    await waitFor(browser.cdp, "Boolean(document.querySelector('.editable-text'))");
    await evaluate(
      browser.cdp,
      `(() => {
        const editable = document.querySelector('.editable-text');
        editable.focus();
        editable.textContent = 'Hello from browser test.';
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Hello from browser test.' }));
        return editable.textContent;
      })()`
    );
    await waitFor(
      browser.cdp,
      "fetch('/api/document').then((response) => response.json()).then((doc) => doc.markdown.includes('Hello from browser test.'))",
      5000
    );

    assert.match(await waitForFileText(markdownPath, /Hello from browser test\./), /Hello from browser test\./);

    await navigate(browser.cdp, `${server.baseUrl}/?reload=${Date.now()}`);
    assert.equal(
      await evaluate(browser.cdp, "document.querySelector('.editable-text')?.textContent.includes('Hello from browser test.')"),
      true
    );
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
});

test("browser responsive smoke: compact header has no title input or horizontal overflow", async (t) => {
  const browser = await browserTest(t);
  if (!browser) return;

  const { rootDir, markdownPath } = await makeMarkdownDoc("draft.md", "# Draft\n\nA short paragraph.\n");
  const server = await startSkribeServer(markdownPath);

  try {
    await disableToneSetup(server.baseUrl);
    await navigate(browser.cdp, server.baseUrl, 742, 1000);
    const metrics = await evaluate(
      browser.cdp,
      `(() => ({
        hasTitleInput: Boolean(document.querySelector('.title-input')),
        viewport: innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        topbarHeight: Math.round(document.querySelector('.topbar')?.getBoundingClientRect().height || 0)
      }))()`
    );

    assert.equal(metrics.hasTitleInput, false);
    assert.ok(metrics.documentScrollWidth <= metrics.viewport, JSON.stringify(metrics));
    assert.ok(metrics.bodyScrollWidth <= metrics.viewport, JSON.stringify(metrics));
    assert.ok(metrics.topbarHeight <= 80, JSON.stringify(metrics));
  } finally {
    await browser.stop();
    await server.stop();
    await removeTempDir(rootDir);
  }
});
