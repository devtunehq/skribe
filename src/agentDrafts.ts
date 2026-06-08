import type { AgentSkill, AgentSkillSelection } from "./types";

function skillCommandId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function skillLabel(skill: AgentSkill | AgentSkillSelection) {
  return skill.name || skill.id;
}

export function findSkillByCommand(skills: AgentSkill[], command: string) {
  const normalized = skillCommandId(command);
  return skills.find((skill) => skill.id === normalized || skillCommandId(skill.name) === normalized) ?? null;
}

export function uniqueSkillIds(ids: string[]) {
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const normalized = skillCommandId(id);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueIds.push(normalized);
    if (uniqueIds.length >= 8) break;
  }
  return uniqueIds;
}

export function getActiveSlashCommand(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)\/([a-zA-Z0-9:_-]*)$/);
  if (!match) return null;
  const start = cursor - match[0].length + match[1].length;
  return {
    start,
    end: cursor,
    query: match[2] ?? ""
  };
}

export function skillMatchesQuery(skill: AgentSkill, query: string) {
  const normalized = query.toLowerCase();
  return (
    skill.id.includes(normalized) ||
    skill.name.toLowerCase().includes(normalized) ||
    skill.description.toLowerCase().includes(normalized)
  );
}

function extractSkillIdsFromDraft(value: string, skills: AgentSkill[]) {
  const ids: string[] = [];
  for (const match of value.matchAll(/(^|\s)\/([a-zA-Z0-9:_-]+)/g)) {
    const skill = findSkillByCommand(skills, match[2]);
    if (skill) ids.push(skill.id);
  }
  return uniqueSkillIds(ids);
}

function stripKnownSkillCommands(value: string, skills: AgentSkill[]) {
  return value
    .replace(/(^|\s)\/([a-zA-Z0-9:_-]+)/g, (match, prefix, command) => {
      return findSkillByCommand(skills, command) || command.toLowerCase() === "skills" ? prefix : match;
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function prepareAgentTurnDraft(value: string, selectedSkillIds: string[], skills: AgentSkill[]) {
  const skillIds = uniqueSkillIds([...selectedSkillIds, ...extractSkillIdsFromDraft(value, skills)]);
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills: AgentSkillSelection[] = [];
  for (const id of skillIds) {
    const skill = skillsById.get(id);
    if (skill) selectedSkills.push({ id: skill.id, name: skill.name });
  }

  const strippedBody = stripKnownSkillCommands(value, skills);
  const skillList = selectedSkills.map((skill) => `/${skill.id}`).join(", ");
  const body =
    strippedBody ||
    (selectedSkills.length > 0
      ? `Apply ${skillList} to the current writing context. If edits are useful, return them as reviewable suggestions or document proposals.`
      : "");
  const summary = strippedBody
    ? selectedSkills.length > 0
      ? `${strippedBody} (${skillList})`
      : strippedBody
    : selectedSkills.length > 0
      ? `Requested ${skillList} on the current writing context.`
      : "";

  return {
    body,
    displayBody: strippedBody,
    summary,
    skillIds,
    skills: selectedSkills
  };
}
