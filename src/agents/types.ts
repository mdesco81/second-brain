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
