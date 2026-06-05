import type {
  AgentMessageRequest,
  AgentRuntimeConfig,
  AgentSkill,
  AppSettings,
  DocumentState,
  RevisionState,
  SettingsResponse,
  ToneInterviewRequest,
  ToneInterviewResponse,
  ToneGenerateRequest,
  ToneGenerateResponse
} from "./types";

export interface UploadedImageAsset {
  filename: string;
  src: string;
  url: string;
  markdown: string;
  contentType: string;
  size: number;
}

export async function fetchDocument(): Promise<DocumentState> {
  const response = await fetch("/api/document", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load document: ${response.status}`);
  return response.json();
}

export async function fetchAppSettings(): Promise<SettingsResponse> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load settings: ${response.status}`);
  return response.json();
}

export async function updateAppSettings(settings: AppSettings): Promise<SettingsResponse> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings })
  });
  if (!response.ok) throw new Error(`Unable to update settings: ${response.status}`);
  return response.json();
}

export async function generateToneOfVoice(request: ToneGenerateRequest): Promise<ToneGenerateResponse> {
  const response = await fetch("/api/tone/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Unable to generate tone of voice: ${response.status}`);
  return payload;
}

export async function sendToneInterviewMessage(request: ToneInterviewRequest): Promise<ToneInterviewResponse> {
  const response = await fetch("/api/tone/interview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Unable to run tone interview: ${response.status}`);
  return payload;
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageAsset(file: File): Promise<UploadedImageAsset> {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      type: file.type,
      dataUrl: await readFileAsDataUrl(file)
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Unable to upload image: ${response.status}`);
  return payload;
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
  effort: string;
}): Promise<{ document: DocumentState; config: AgentRuntimeConfig; settings?: AppSettings }> {
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
