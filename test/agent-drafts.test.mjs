import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveSlashCommand,
  prepareAgentTurnDraft,
  skillMatchesQuery,
  uniqueSkillIds
} from "../src/agentDrafts.ts";

const skills = [
  {
    id: "humanizer",
    name: "Humanizer",
    description: "Remove signs of AI-generated writing.",
    source: "local"
  },
  {
    id: "plgeek-voice",
    name: "PLGeek Voice",
    description: "Rewrite in the house product-growth style.",
    source: "local"
  }
];

test("slash-only skill drafts produce an agent instruction", () => {
  const draft = prepareAgentTurnDraft("/humanizer", [], skills);

  assert.equal(
    draft.body,
    "Apply /humanizer to the current writing context. If edits are useful, return them as reviewable suggestions or document proposals."
  );
  assert.equal(draft.displayBody, "");
  assert.equal(draft.summary, "Requested /humanizer on the current writing context.");
  assert.deepEqual(draft.skillIds, ["humanizer"]);
  assert.deepEqual(draft.skills, [{ id: "humanizer", name: "Humanizer" }]);
});

test("draft preparation merges selected and typed skills without duplicating commands", () => {
  const draft = prepareAgentTurnDraft("Tighten this with /Humanizer and keep the edge.", ["plgeek-voice"], skills);

  assert.equal(draft.body, "Tighten this with and keep the edge.");
  assert.equal(draft.displayBody, "Tighten this with and keep the edge.");
  assert.equal(draft.summary, "Tighten this with and keep the edge. (/plgeek-voice, /humanizer)");
  assert.deepEqual(draft.skillIds, ["plgeek-voice", "humanizer"]);
});

test("unknown slash commands remain in the message body", () => {
  const draft = prepareAgentTurnDraft("Use /unknown-pass carefully.", [], skills);

  assert.equal(draft.body, "Use /unknown-pass carefully.");
  assert.equal(draft.summary, "Use /unknown-pass carefully.");
  assert.deepEqual(draft.skillIds, []);
});

test("slash command parsing and skill matching support autocomplete", () => {
  assert.deepEqual(getActiveSlashCommand("Try /hum", 8), {
    start: 4,
    end: 8,
    query: "hum"
  });
  assert.equal(getActiveSlashCommand("Try /hum now", 12), null);
  assert.equal(skillMatchesQuery(skills[1], "growth"), true);
  assert.deepEqual(uniqueSkillIds(["Humanizer", "humanizer", "plgeek voice", "", "PLGeek Voice"]), [
    "humanizer",
    "plgeek-voice"
  ]);
});
