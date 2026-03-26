// Intel Analyst Chat — message types
// Aligned with the screenshot UI: user bubbles, chain-of-thought, data sources,
// SITREP cards, and model info blocks.

export type MessageId = string;

export type MessageRole = 'user' | 'assistant';

export interface UserMessage {
  id: MessageId;
  role: 'user';
  content: string;
  timestamp: number;
}

export interface AssistantMessage {
  id: MessageId;
  role: 'assistant';
  content: string;
  chainOfThought?: ChainOfThoughtBlock;
  dataSources?: DataSourceEntry[];
  sitrep?: SitrepBlock;
  modelInfo?: ModelInfoBlock;
  timestamp: number;
}

export type ChatMessage = UserMessage | AssistantMessage;

// ── Sub-blocks ──────────────────────────────────────────────────────────────

export interface ChainOfThoughtBlock {
  steps: string[];
  collapsed?: boolean;
}

export interface DataSourceEntry {
  label: string;
  url?: string;
  snippet?: string;
}

export interface SitrepBlock {
  /** e.g. "South China Sea / Taiwan" */
  title: string;
  /** ISO 8601 timestamp */
  generatedAt: string;
  classification: 'UNCLASSIFIED' | 'CONFIDENTIAL' | 'SECRET';
  bluf?: string; // Bottom Line Up Front
  sections: SitrepSection[];
  overallSeverity?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

export interface SitrepSection {
  heading: string;
  body: string;
}

export interface ModelInfoBlock {
  name: string;
  provider: string;
  latencyMs?: number;
  tokensUsed?: number;
}

// ── Callbacks that will be wired to real API / SSE in future ────────────────

export interface IntelChatCallbacks {
  /** Called when the user submits a message. Payload matches ChatMessage[role='user']. */
  onSendMessage: (text: string) => void;
  /**
   * Called with streaming fragments while the assistant is typing.
   * Append each fragment to accumulate the final response.
   */
  onStreamChunk?: (messageId: MessageId, chunk: string) => void;
  /** Called when the stream completes or on error. */
  onStreamDone?: (messageId: MessageId) => void;
}

// ── Session ─────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ── Quota display ────────────────────────────────────────────────────────────

export interface QuotaInfo {
  used: number;
  total: number;
  resetsAt?: string; // ISO 8601
}
