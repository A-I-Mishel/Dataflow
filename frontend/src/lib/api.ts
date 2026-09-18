import type {
  ExecuteResponse,
  GenerateResponse,
  PipelineEdge,
  PipelineNode,
  ProfileData,
  UploadResponse,
} from "../types";

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof window !== "undefined" && window.location.hostname.endsWith("vercel.app")
    ? "https://dataflow-cleaner-api.onrender.com"
    : "http://localhost:8000");

const API_KEY_STORAGE = "dataflow-api-key";

function getApiKey(): string {
  try {
    const existing = localStorage.getItem(API_KEY_STORAGE);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(API_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return "default";
  }
}

const API_KEY = getApiKey();

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "X-API-Key": API_KEY, ...extra };
}

interface BackendNode {
  id: string;
  type: string;
  config: PipelineNode["data"]["config"];
}

export function serializeNodes(nodes: PipelineNode[]): BackendNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    config: stripClientOnlyFields(node.data.config),
  }));
}

/**
 * Remove client-only bookkeeping before sending a config to the backend.
 * Today that is just filter-row condition `id`s (stable React keys); the
 * backend reads known keys via `.get()` and would ignore them, but the
 * wire contract stays clean by construction — including saved pipelines
 * and the generated script path, which share this serializer.
 */
function stripClientOnlyFields(
  config: PipelineNode["data"]["config"],
): PipelineNode["data"]["config"] {
  if (config.conditions === undefined) return config;
  return {
    ...config,
    conditions: config.conditions.map((condition) => {
      const { id: _clientId, ...wireCondition } = condition;
      return wireCondition;
    }),
  };
}

function apiHost(): string {
  try {
    return new URL(API_BASE).host;
  } catch {
    return API_BASE;
  }
}

function connectionError(): Error {
  // Name the real host: the old localhost:8000 text sent production users
  // chasing a server that was never supposed to be local. Render free-tier
  // restarts/sleeps read as fetch throws, so say that too.
  return new Error(
    `Cannot reach the API at ${apiHost()}. It may be restarting or asleep — wait a minute and retry.`,
  );
}

async function parseError(response: Response): Promise<Error> {
  if (response.status === 404) {
    return new Error("Session expired. Please re-upload your file.");
  }
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail !== "") {
      return new Error(body.detail);
    }
  } catch {
    // Fall through to generic message below.
  }
  return new Error(`Request failed with status ${response.status}`);
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw connectionError();
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as T;
}

export async function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadResponse> {
  const sessionId = crypto.randomUUID();
  const formData = new FormData();
  formData.append("file", file, file.name);
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);
    xhr.setRequestHeader("x-session-id", sessionId);
    xhr.setRequestHeader("X-API-Key", API_KEY);
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = (): void => {
      xhr.abort();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    xhr.upload.onprogress = (event: ProgressEvent): void => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onabort = (): void => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.onload = (): void => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new Error("Upload failed: invalid server response"));
        }
        return;
      }
      if (xhr.status === 404) {
        reject(new Error("Session expired. Please re-upload your file."));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { detail?: unknown };
        if (typeof body.detail === "string" && body.detail !== "") {
          reject(new Error(body.detail));
          return;
        }
      } catch {
        // Fall through to the generic message below.
      }
      reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = (): void => {
      cleanup();
      reject(connectionError());
    };
    xhr.send(formData);
  });
}

export async function executePipeline(
  sessionId: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  signal?: AbortSignal,
): Promise<ExecuteResponse> {
  return postJson<ExecuteResponse>(
    "/execute",
    {
      session_id: sessionId,
      nodes: serializeNodes(nodes),
      edges,
    },
    signal,
  );
}

// Note: /generate is sessionless server-side (pure function of the
// pipeline). session_id is still sent for request-shape compat but the
// server ignores it, so code export works even after session expiry.
export async function generateCode(
  sessionId: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  signal?: AbortSignal,
): Promise<GenerateResponse> {
  return postJson<GenerateResponse>(
    "/generate",
    {
      session_id: sessionId,
      nodes: serializeNodes(nodes),
      edges,
    },
    signal,
  );
}

export async function getProfile(sessionId: string): Promise<ProfileData> {
  return postJson<ProfileData>("/profile", { session_id: sessionId });
}

export async function downloadCSV(sessionId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/download/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: authHeaders(),
    });
  } catch {
    throw connectionError();
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.blob();
}

export interface ServerPipelineSummary {
  id: string;
  name: string;
  created_at: string;
}

export async function savePipeline(
  name: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Promise<ServerPipelineSummary> {
  return postJson<ServerPipelineSummary>("/pipelines/save", { name, nodes, edges });
}

export async function getPipelines(): Promise<ServerPipelineSummary[]> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/pipelines`, {
      method: "GET",
      headers: authHeaders(),
    });
  } catch {
    throw connectionError();
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as ServerPipelineSummary[];
}

export async function loadPipeline(
  id: string,
): Promise<{ nodes: PipelineNode[]; edges: PipelineEdge[] }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/pipelines/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: authHeaders(),
    });
  } catch {
    throw connectionError();
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as { nodes: PipelineNode[]; edges: PipelineEdge[] };
}

export async function deletePipeline(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/pipelines/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  } catch {
    throw connectionError();
  }
  if (!response.ok) {
    throw await parseError(response);
  }
}
