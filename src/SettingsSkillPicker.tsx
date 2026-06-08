import { useState } from "react";
import { Search, X } from "lucide-react";
import {
  skillLabel,
  skillMatchesQuery,
  uniqueSkillIds
} from "./agentDrafts";
import type { AgentSkill } from "./types";

export function SettingsSkillPicker({
  skills,
  selectedSkillIds,
  onChange
}: {
  skills: AgentSkill[];
  selectedSkillIds: string[];
  onChange: (skillIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills: AgentSkill[] = selectedSkillIds.map((id) => skillsById.get(id) ?? { id, name: id, description: "", source: "saved" });
  const filteredSkills = skills.filter((skill) => skillMatchesQuery(skill, query)).slice(0, 20);

  function removeSkill(skillId: string) {
    onChange(selectedSkillIds.filter((id) => id !== skillId));
  }

  function toggleSkill(skillId: string) {
    onChange(
      selectedSkillIds.includes(skillId)
        ? selectedSkillIds.filter((id) => id !== skillId)
        : uniqueSkillIds([...selectedSkillIds, skillId])
    );
  }

  return (
    <div className="settings-skill-picker">
      {selectedSkills.length > 0 ? (
        <div className="skill-chip-row" aria-label="Default agent skills">
          {selectedSkills.map((skill) => (
            <button type="button" key={skill.id} className="skill-chip" onClick={() => removeSkill(skill.id)} title={`Remove ${skillLabel(skill)}`}>
              /{skill.id}
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}

      <label className="skill-search settings-skill-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" />
      </label>

      <div className="settings-skill-list">
        {filteredSkills.length === 0 ? (
          <p className="empty-note">No skills match that search.</p>
        ) : (
          filteredSkills.map((skill) => {
            const selected = selectedSkillIds.includes(skill.id);
            return (
              <button type="button" key={skill.id} className={selected ? "is-selected" : ""} onClick={() => toggleSkill(skill.id)}>
                <span>
                  <strong>/{skill.id}</strong>
                  <small>{skill.description || skill.source}</small>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
