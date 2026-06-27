import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProposalDecisionTransitions,
  buildInlineProposalReview,
  buildMarkdownFromProposalDecisions,
  buildProposalDiff,
  getProposalChangeBlocks,
  resolveProposalStatus
} from "../src/proposals.ts";
import { parseMarkdownBlocks } from "../src/document.ts";
import { getMarkdownBlockLineSpans } from "../src/markdownRanges.ts";

function makeProposal(overrides = {}) {
  return {
    id: "proposal-test",
    source: "chat",
    title: "Edit pass",
    summary: "Test proposal",
    originalMarkdown: "",
    replacementMarkdown: "",
    status: "open",
    author: "agent",
    createdAt: "2026-06-03T00:00:00.000Z",
    ...overrides
  };
}

const originalMarkdown = `# Draft

First original.

Keep 1.

Keep 2.

Keep 3.

Keep 4.

Keep 5.

Second original.

End.
`;

const replacementMarkdown = `# Draft

First improved.

Keep 1.

Keep 2.

Keep 3.

Keep 4.

Keep 5.

Second improved.

End.
`;

function changedBlocks(proposal) {
  const changes = getProposalChangeBlocks(buildProposalDiff(proposal));
  return {
    changes,
    first: changes.find((change) => change.additions.join("").includes("First improved")),
    second: changes.find((change) => change.additions.join("").includes("Second improved"))
  };
}

test("inline proposal changes anchor by content when the document is edited above", () => {
  const proposal = makeProposal({ originalMarkdown, replacementMarkdown });
  // A new paragraph is inserted at the top of the live document, shifting every
  // block's position down by one.
  const currentMarkdown = originalMarkdown.replace("# Draft\n", "# Draft\n\nNewly added intro.\n");

  const review = buildInlineProposalReview(proposal, currentMarkdown);
  const firstChange = review.changes.find((change) => change.deletions.join("").includes("First original"));
  assert.ok(firstChange, "expected a change targeting 'First original.'");

  // The anchored block in the current document must actually contain the source
  // text — not whatever now sits at the original positional index.
  const currentBlocks = parseMarkdownBlocks(currentMarkdown);
  const anchorIndex = getMarkdownBlockLineSpans(currentMarkdown).findIndex(
    (span) => span.id === firstChange.anchorBlockId
  );
  assert.ok(anchorIndex >= 0, "anchor block id should exist in the current document");
  assert.equal(currentBlocks[anchorIndex].text.trim(), "First original.");
});

test("proposal change decisions apply individual blocks without reordering untouched content", () => {
  const proposal = makeProposal({ originalMarkdown, replacementMarkdown });
  const { first, second } = changedBlocks(proposal);
  assert.ok(first);
  assert.ok(second);

  const markdown = buildMarkdownFromProposalDecisions(proposal, { [second.key]: "accepted" });

  assert.match(markdown, /First original\./);
  assert.doesNotMatch(markdown, /First improved\./);
  assert.match(markdown, /Second improved\./);
  assert.doesNotMatch(markdown, /Second original\./);
  assert.ok(markdown.indexOf("Keep 5.") < markdown.indexOf("Second improved."));
  assert.ok(markdown.indexOf("Second improved.") < markdown.indexOf("End."));
});

test("accepting a proposal change preserves unrelated manual edits in the live document", () => {
  const proposal = makeProposal({ originalMarkdown, replacementMarkdown });
  const { second } = changedBlocks(proposal);
  assert.ok(second);

  const currentMarkdown = originalMarkdown.replace("End.\n", "End.\n\nManual note.\n");
  const markdown = applyProposalDecisionTransitions(currentMarkdown, proposal, { [second.key]: "accepted" });

  assert.match(markdown, /First original\./);
  assert.match(markdown, /Second improved\./);
  assert.match(markdown, /Manual note\./);
  assert.ok(markdown.indexOf("Second improved.") < markdown.indexOf("End."));
  assert.ok(markdown.indexOf("End.") < markdown.indexOf("Manual note."));
});

test("rejecting a previously accepted proposal change restores only that block", () => {
  const proposal = makeProposal({ originalMarkdown, replacementMarkdown });
  const { first } = changedBlocks(proposal);
  assert.ok(first);

  const acceptedProposal = {
    ...proposal,
    changeDecisions: { [first.key]: "accepted" }
  };
  const currentMarkdown = buildMarkdownFromProposalDecisions(proposal, acceptedProposal.changeDecisions).replace(
    "End.\n",
    "End.\n\nManual note.\n"
  );
  const markdown = applyProposalDecisionTransitions(currentMarkdown, acceptedProposal, {});

  assert.match(markdown, /First original\./);
  assert.doesNotMatch(markdown, /First improved\./);
  assert.match(markdown, /Second original\./);
  assert.match(markdown, /Manual note\./);
});

test("proposal status distinguishes open, reviewed, accepted, and rejected states", () => {
  const proposal = makeProposal({ originalMarkdown, replacementMarkdown });
  const { changes, first, second } = changedBlocks(proposal);
  assert.ok(first);
  assert.ok(second);

  assert.equal(resolveProposalStatus(changes, {}), "open");
  assert.equal(resolveProposalStatus(changes, { [first.key]: "accepted", [second.key]: "rejected" }), "reviewed");
  assert.equal(resolveProposalStatus(changes, { [first.key]: "accepted", [second.key]: "accepted" }), "accepted");
  assert.equal(resolveProposalStatus(changes, { [first.key]: "rejected", [second.key]: "rejected" }), "rejected");
});
