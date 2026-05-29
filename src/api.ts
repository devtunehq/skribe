import type { AgentMessageRequest, DocumentState } from "./types";

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
