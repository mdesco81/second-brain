export interface AgentIntent {
  agentId: string;
  confidence: number;
  rawRequest: string;
  metadata: Record<string, unknown>;
}

export interface AgentRequest {
  chatId: number;
  messageId: number;
  agentId: string;
  rawRequest: string;
  intent: AgentIntent;
  timestamp: Date;
  mediaContent?: string;  // Extracted content from PDF/image attachments
}

export interface AgentResult {
  success: boolean;
  agentId: string;
  outputPath?: string;
  itemId?: number;
  summary: string;
  error?: string;
}

export type AgentHandler = (request: AgentRequest) => Promise<AgentResult>;

// ── Orchestrator types ──────────────────────────────────────────────

export interface OrchestratorAction {
  agent: "marta" | "jarbas" | "pesquisa" | "intake";
  confidence: number;
  reasoning: string;
  extractedRequest: string;
  intentHint?: string;
  contentTypeHint?: "post" | "article";
}

export interface OrchestratorResult {
  actions: OrchestratorAction[];
  isFollowUp: boolean;
  followUpContext?: string;
  needsClarification: boolean;
  clarificationQuestion?: string;
  rawReasoning: string;
}

export interface DispatchResult {
  intakeText: string | null;
  agentResults: Array<{ agent: string; success: boolean; error?: string }>;
}

export interface ChatContextEntry {
  id: number;
  chatId: number;
  role: string;
  content: string;
  agent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestratorMemory {
  id: number;
  chatId: number;
  memoryType: string;
  key: string;
  content: string;
  confidence: number;
  timesConfirmed: number;
  timesUsed: number;
  active: boolean;
  createdAt: string;
}
