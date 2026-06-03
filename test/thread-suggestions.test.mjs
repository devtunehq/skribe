import assert from "node:assert/strict";
import test from "node:test";

import {
  applyThreadSuggestionToMarkdown,
  findThreadAnchorInText,
  getThreadAnchorCandidates
} from "../src/threadSuggestions.ts";

function makeThread(anchor, suggestions = []) {
  return {
    id: "thread-test",
    status: "open",
    anchor,
    messages: [],
    suggestions,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z"
  };
}

function makeSuggestion(overrides = {}) {
  return {
    id: "suggestion-test",
    threadId: "thread-test",
    type: "replace",
    original: "",
    replacement: "",
    status: "open",
    author: "agent",
    createdAt: "2026-06-03T00:00:00.000Z",
    ...overrides
  };
}

test("thread anchor candidates include accepted replacements for persisted highlights", () => {
  const thread = makeThread(
    {
      exact: "Original phrase",
      prefix: "",
      suffix: "",
      start: 0,
      end: "Original phrase".length
    },
    [
      makeSuggestion({ replacement: "Open suggestion", status: "open" }),
      makeSuggestion({ replacement: "Accepted phrase", status: "accepted" })
    ]
  );

  assert.deepEqual(getThreadAnchorCandidates(thread), ["Original phrase", "Accepted phrase", "Open suggestion"]);
  assert.deepEqual(findThreadAnchorInText(thread, "The Accepted phrase is in the document."), {
    exact: "Accepted phrase",
    start: 4,
    end: 19
  });
});

test("thread suggestions apply to an exact markdown range and preserve surrounding text", () => {
  const markdown = "Before.\n\nTarget sentence original.\n\nAfter.\n";
  const original = "Target sentence original.";
  const start = markdown.indexOf(original);
  const suggestion = makeSuggestion({
    original,
    replacement: "Target sentence improved."
  });
  const thread = makeThread({
    kind: "markdown-range",
    exact: original,
    prefix: "Before.",
    suffix: "After.",
    start,
    end: start + original.length
  });

  const nextMarkdown = applyThreadSuggestionToMarkdown(markdown, thread, suggestion);

  assert.equal(nextMarkdown, "Before.\n\nTarget sentence improved.\n\nAfter.\n");
});

test("thread suggestions fall back to exact anchor text when range offsets are stale", () => {
  const markdown = "Intro.\n\nKeycard.ai is another company worth watching here.\n\nOutro.\n";
  const original = "Keycard.ai is another company worth watching here.";
  const suggestion = makeSuggestion({
    original,
    replacement:
      "[Keycard.ai](https://www.keycard.ai/) is worth watching because it frames agent access as a control plane."
  });
  const thread = makeThread({
    kind: "markdown-range",
    exact: original,
    prefix: "",
    suffix: "",
    start: 0,
    end: 12
  });

  const nextMarkdown = applyThreadSuggestionToMarkdown(markdown, thread, suggestion);

  assert.match(nextMarkdown, /\[Keycard\.ai\]\(https:\/\/www\.keycard\.ai\/\)/);
  assert.doesNotMatch(nextMarkdown, /another company worth watching here/);
  assert.match(nextMarkdown, /^Intro\./);
  assert.match(nextMarkdown, /Outro\.\n$/);
});

test("thread suggestions use a fuzzy window when the target passage has moved or changed lightly", () => {
  const markdown =
    "Intro.\n\nKeycard.ai frames agent access as a control plane for delegated credentials and audit trails.\n\nOutro.\n";
  const original = "Keycard.ai is another company worth watching here.";
  const replacement =
    "[Keycard.ai](https://www.keycard.ai/) is worth watching because it frames agent access as a control plane for delegated credentials and audit trails.";
  const suggestion = makeSuggestion({ original, replacement });
  const thread = makeThread({
    exact: original,
    prefix: "",
    suffix: "",
    start: 0,
    end: original.length
  });

  const nextMarkdown = applyThreadSuggestionToMarkdown(markdown, thread, suggestion);

  assert.match(nextMarkdown, /\[Keycard\.ai\]\(https:\/\/www\.keycard\.ai\/\)/);
  assert.match(nextMarkdown, /Intro\.\n\n/);
  assert.match(nextMarkdown, /\n\nOutro\.\n$/);
  assert.doesNotMatch(nextMarkdown, /Keycard\.ai frames agent access/);
});
