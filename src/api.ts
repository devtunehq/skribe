import type { AgentMessageRequest, AgentRuntimeConfig, AgentSkill, DocumentState, RevisionState } from "./types";

export async function fetchDocument(): Promise<DocumentState> {
  const response = await fetch("/api/document", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load document: ${response.status}`);
  return response.json();
}

export async function saveDocument(state: DocumentState): Promise<DocumentState> {
  const response = await fetch("/api/document", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markdown: state.markdown,
      review: state.review
    })
  });
  if (!response.ok) throw new Error(`Unable to save document: ${response.status}`);
  return response.json();
}

export async function fetchRevisionHistory(): Promise<RevisionState> {
  const response = await fetch("/api/revisions", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load revisions: ${response.status}`);
  return response.json();
}

export async function restoreDocumentRevision(
  revisionId: string
): Promise<{ document: DocumentState; revisions: RevisionState }> {
  const response = await fetch("/api/revisions/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revisionId })
  });
  if (!response.ok) throw new Error(`Unable to restore revision: ${response.status}`);
  return response.json();
}

export async function fetchAgentSkills(): Promise<AgentSkill[]> {
  const response = await fetch("/api/skills", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load agent skills: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.skills) ? payload.skills : [];
}

export async function fetchAgentRuntimes(): Promise<AgentRuntimeConfig> {
  const response = await fetch("/api/agent/runtimes", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load agent runtimes: ${response.status}`);
  return response.json();
}

export async function updateAgentConfig(config: {
  runtime: string;
  model: string;
}): Promise<{ document: DocumentState; config: AgentRuntimeConfig }> {
  const response = await fetch("/api/agent/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) throw new Error(`Unable to update agent config: ${response.status}`);
  return response.json();
}

export async function sendAgentMessage(request: AgentMessageRequest): Promise<DocumentState> {
  const response = await fetch("/api/agent/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error(`Unable to send agent message: ${response.status}`);
  return response.json();
}

export function subscribeToDocumentEvents(onDocument: (state: DocumentState) => void) {
  const source = new EventSource("/api/events");
  source.addEventListener("document", (event) => {
    onDocument(JSON.parse((event as MessageEvent).data));
  });
  return () => source.close();
}
