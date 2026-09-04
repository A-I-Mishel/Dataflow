import type {
  ExecuteResponse,
  GenerateResponse,
  PipelineEdge,
  PipelineNode,
  ProfileData,
  UploadResponse,
} from '../types';

// TODO: Change base URL for production (e.g. use import.meta.env or the deployed Render URL).
const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

const API_KEY_STORAGE = 'dataflow-api-key';

function getApiKey(): string {
  try {
    const existing = localStorage.getItem(API_KEY_STORAGE);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(API_KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return 'default';
  }
}

const API_KEY = getApiKey();

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'X-API-Key': API_KEY, ...extra };
}

interface BackendNode {
  id: string;
  type: string;
  config: PipelineNode['data']['config'];
}

function serializeNodes(nodes: PipelineNode[]): BackendNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    config: node.data.config,
  }));
}

function connectionError(): Error {
  return new Error('Cannot connect to backend. Is the server running on localhost:8000?');
}

async function parseError(response: Response): Promise<Error> {
  if (response.status === 404) {
    return new Error('Session expired. Please re-upload your file.');
  }
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string' && body.detail !== '') {
      return new Error(body.detail);
    }
  } catch {
    // Fall through to generic message below.
  }
  return new Error(`Request failed with status ${response.status}`);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  } catch {
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
): Promise<UploadResponse> {
  const sessionId = crypto.randomUUID();
  const formData = new FormData();
  formData.append('file', file, file.name);
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload`);
    xhr.setRequestHeader('x-session-id', sessionId);
    xhr.setRequestHeader('X-API-Key', API_KEY);
    xhr.upload.onprogress = (event: ProgressEvent): void => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new Error('Upload failed: invalid server response'));
        }
        return;
      }
      if (xhr.status === 404) {
        reject(new Error('Session expired. Please re-upload your file.'));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { detail?: unknown };
        if (typeof body.detail === 'string' && body.detail !== '') {
          reject(new Error(body.detail));
          return;
        }
      } catch {
        // Fall through to the generic message below.
      }
      reject(new Error(`Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = (): void => {
      reject(connectionError());
    };
    xhr.send(formData);
  });
}

export async function executePipeline(
  sessionId: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Promise<ExecuteResponse> {
  return postJson<ExecuteResponse>('/execute', {
    session_id: sessionId,
    nodes: serializeNodes(nodes),
    edges,
  });
}

export async function generateCode(
  sessionId: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Promise<GenerateResponse> {
  return postJson<GenerateResponse>('/generate', {
    session_id: sessionId,
    nodes: serializeNodes(nodes),
    edges,
  });
}

export async function getProfile(sessionId: string): Promise<ProfileData> {
  return postJson<ProfileData>('/profile', { session_id: sessionId });
}

export async function downloadCSV(sessionId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/download/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
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
  return postJson<ServerPipelineSummary>('/pipelines/save', { name, nodes, edges });
}

export async function getPipelines(): Promise<ServerPipelineSummary[]> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/pipelines`, {
      method: 'GET',
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
      method: 'GET',
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
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch {
    throw connectionError();
  }
  if (!response.ok) {
    throw await parseError(response);
  }
}
