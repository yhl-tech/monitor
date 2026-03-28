/**
 * OSINT Intel Hub — Chat API Service
 *
 * Service layer for OSINT Agent pipeline (natural language command → analysis).
 * Provides typed interfaces for command submission, SSE streaming, and result retrieval.
 *
 * Backend endpoint reference: server/backend/app/routers/agent.py
 */

import { getRpcBaseUrl } from '@/services/rpc-client';

/**
 * OSINT API base URL configuration.
 *
 * Priority order:
 * 1. VITE_OSINT_API_URL env var - for custom deployments
 * 2. Desktop runtime - use sidecar port (runtime fetch patch handles token)
 * 3. Empty string - use relative path /api/osint (Vite proxy in dev mode)
 *
 * Vite proxy config (vite.config.ts):
 *   /api/osint -> http://localhost:8000
 *
 * This avoids CSP "connect-src" restrictions in development.
 */
const OSINT_API_BASE = (() => {
  // Allow env var override for custom backend URLs (production)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OSINT_API_URL) {
    return import.meta.env.VITE_OSINT_API_URL as string;
  }

  // Desktop runtime: use sidecar port (runtime fetch patch handles token injection)
  const rpcBase = getRpcBaseUrl();
  if (rpcBase) return rpcBase;

  // Web dev: use relative path for Vite proxy
  return '';
})();

/**
 * API path prefix.
 * - With Vite proxy: /api/osint (proxied to localhost:8000)
 * - With env var: /agent (relative to VITE_OSINT_API_URL)
 * - Desktop runtime: /agent (relative to sidecar port)
 */
const API_PREFIX = (() => {
  // If using custom API URL, use /agent prefix
  if (OSINT_API_BASE && !OSINT_API_BASE.startsWith('/')) {
    return '/agent';
  }
  // With Vite proxy or empty base, use /api/osint
  return '/api/osint';
})();

// ─── Request/Response Types ────────────────────────────────────────────────────

/** Natural language command input */
export interface AgentCommandRequest {
  command: string;
  person_id?: number;
}

/** Agent task metadata */
export interface AgentTaskOut {
  id: number;
  person_id?: number;
  person_name?: string;
  command_text: string;
  status: 'pending' | 'collecting' | 'analyzing' | 'reasoning' | 'done' | 'failed';
  summary?: string;
  created_at?: string;
  updated_at?: string;
}

/** Evidence item from data collection */
export interface EvidenceItemOut {
  id: number;
  task_id: number;
  category: 'social_media' | 'public_media' | 'app_info' | 'relationship' | 'other';
  title: string;
  content: string;
  source_url?: string;
  source_platform?: string;
  confidence?: number;
  sort_order: number;
  created_at?: string;
}

/** Reasoning step in the analysis chain */
export interface ReasoningStepOut {
  id: number;
  task_id: number;
  step_number: number;
  step_type: 'collection' | 'analysis' | 'correlation' | 'prediction' | 'conclusion';
  description: string;
  result?: string;
  probability?: Record<string, unknown>;
  evidence_ids?: number[];
  created_at?: string;
}

/** Complete agent pipeline result */
export interface AgentTaskResult {
  task: AgentTaskOut;
  evidence: EvidenceItemOut[];
  reasoning: ReasoningStepOut[];
}

// ─── SSE Event Types ──────────────────────────────────────────────────────────

export type SSEEventType = 'status' | 'evidence' | 'reasoning' | 'conclusion' | 'error';

export interface SSEEvent<T = unknown> {
  event_type: SSEEventType;
  data: T;
}

export interface SSEStatusData {
  phase: string;
  message: string;
}

export interface SSEEvidenceData {
  id: number;
  category: string;
  title: string;
  content: string;
  confidence?: number;
  sort_order: number;
}

export interface SSEReasoningData {
  step_number: number;
  step_type: string;
  description: string;
  result?: string;
  probability?: Record<string, unknown>;
}

export interface SSEConclusionData {
  summary: string;
  person_name: string;
  status: string;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Build full URL for OSINT API endpoint.
 */
function buildUrl(path: string): string {
  return `${OSINT_API_BASE}${API_PREFIX}${path}`;
}

/**
 * Get authentication headers.
 * Note: Token should be obtained from auth service and stored securely.
 * In desktop runtime, token is automatically injected by runtime fetch patch.
 */
/**
 * Hardcoded JWT token for OSINT Intel Hub API (analyst role).
 * Used only for development/demo purposes — does not affect other modules.
 */
const OSINT_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjIsInJvbGUiOiJhbmFseXN0IiwidXNlcm5hbWUiOiJhbmFseXN0IiwiZXhwIjoxNzc0NzEwODgwLCJ0eXBlIjoiYWNjZXNzIn0.N60_R-gTxTUcHtAvFt8jer8se2IcqUMLL5YR_i2xabg";

function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OSINT_API_TOKEN}`,
  };
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Submit a natural language command to start an OSINT analysis pipeline.
 *
 * @param command - Natural language analysis command
 * @param personId - Optional target person ID
 * @param signal - Optional AbortSignal for cancellation
 * @returns Complete agent task result with evidence and reasoning chain
 *
 * @example
 * ```ts
 * const result = await submitAgentCommand("分析张三最近的行踪");
 * console.log(result.task.summary);
 * result.evidence.forEach(e => console.log(e.title, e.confidence));
 * ```
 */
export async function submitAgentCommand(
  command: string,
  personId?: number,
  signal?: AbortSignal,
): Promise<AgentTaskResult> {
  const body: AgentCommandRequest = { command };
  if (personId !== undefined) {
    body.person_id = personId;
  }

  const response = await fetch(buildUrl('/agent/command'), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Agent command failed (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return json as AgentTaskResult;
}

/**
 * Fetch the result of a completed agent task.
 *
 * @param taskId - The task ID to fetch
 * @param signal - Optional AbortSignal for cancellation
 * @returns Complete agent task result
 */
export async function fetchAgentResult(
  taskId: string | number,
  signal?: AbortSignal,
): Promise<AgentTaskResult> {
  const response = await fetch(buildUrl(`/agent/${taskId}/result`), {
    method: 'GET',
    headers: getAuthHeaders(),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Fetch agent result failed (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return json as AgentTaskResult;
}

/**
 * Fetch evidence items for a task, optionally filtered by category.
 *
 * @param taskId - The task ID
 * @param category - Optional category filter
 * @param signal - Optional AbortSignal for cancellation
 * @returns List of evidence items
 */
export async function fetchAgentEvidence(
  taskId: string | number,
  category?: string,
  signal?: AbortSignal,
): Promise<EvidenceItemOut[]> {
  const url = new URL(buildUrl(`/agent/${taskId}/evidence`), window.location.origin);
  if (category) {
    url.searchParams.set('category', category);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Fetch agent evidence failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as EvidenceItemOut[];
}

// ─── SSE Streaming ────────────────────────────────────────────────────────────

/**
 * SSE event handler callback types.
 */
export interface SSECallbacks {
  onStatus?: (data: SSEStatusData) => void;
  onEvidence?: (data: SSEEvidenceData) => void;
  onReasoning?: (data: SSEReasoningData) => void;
  onConclusion?: (data: SSEConclusionData) => void;
  onError?: (error: Error) => void;
}

/**
 * Parse SSE data line and return parsed JSON.
 */
function parseSSELine(line: string): string | null {
  if (line.startsWith('data: ')) {
    return line.slice(6).trim();
  }
  return null;
}

/**
 * Stream agent analysis progress via Server-Sent Events.
 * Calls appropriate callbacks for each event type.
 *
 * @param taskId - The task ID to stream
 * @param callbacks - Event handlers
 * @param signal - Optional AbortSignal for cancellation
 * @returns Cleanup function to stop streaming
 *
 * @example
 * ```ts
 * const cleanup = await streamAgentProgress(123, {
 *   onStatus: (data) => console.log(data.phase, data.message),
 *   onEvidence: (data) => appendEvidence(data),
 *   onConclusion: (data) => showSummary(data.summary),
 * });
 * // Later: cleanup();
 * ```
 */
export async function streamAgentProgress(
  taskId: string | number,
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<() => void> {
  const controller = new AbortController();

  // Merge external signal with internal controller
  const externalSignalHandler = () => {
    controller.abort();
  };
  signal?.addEventListener('abort', externalSignalHandler);

  const response = await fetch(buildUrl(`/agent/${taskId}/stream`), {
    method: 'GET',
    headers: {
      ...getAuthHeaders(),
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
    signal: controller.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    const error = new Error(`Stream agent progress failed (${response.status}): ${errorText}`);
    callbacks.onError?.(error);
    return () => {
      signal?.removeEventListener('abort', externalSignalHandler);
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const error = new Error('Response body is not readable');
    callbacks.onError?.(error);
    return () => {
      signal?.removeEventListener('abort', externalSignalHandler);
    };
  }

  let buffer = '';

  const processBuffer = () => {
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const dataStr = parseSSELine(line);
      if (!dataStr) continue;

      try {
        const event: SSEEvent = JSON.parse(dataStr);

        switch (event.event_type) {
          case 'status':
            callbacks.onStatus?.(event.data as SSEStatusData);
            break;
          case 'evidence':
            callbacks.onEvidence?.(event.data as SSEEvidenceData);
            break;
          case 'reasoning':
            callbacks.onReasoning?.(event.data as SSEReasoningData);
            break;
          case 'conclusion':
            callbacks.onConclusion?.(event.data as SSEConclusionData);
            break;
          case 'error':
            callbacks.onError?.(new Error((event.data as { message?: string }).message ?? 'Unknown error'));
            break;
        }
      } catch {
        // Skip malformed JSON
      }
    }
  };

  const readStream = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value, { stream: true });
        buffer += chunk;
        processBuffer();
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        processBuffer();
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        callbacks.onError?.(error as Error);
      }
    }
  };

  void readStream();

  return () => {
    controller.abort();
    signal?.removeEventListener('abort', externalSignalHandler);
  };
}

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type {
  AgentCommandRequest as ChatCommandRequest,
  AgentTaskOut as ChatTaskOut,
  EvidenceItemOut as ChatEvidence,
  ReasoningStepOut as ChatReasoning,
  AgentTaskResult as ChatResult,
};
