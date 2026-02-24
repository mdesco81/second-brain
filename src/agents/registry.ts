import { AgentHandler } from "./types.js";

const agents = new Map<string, AgentHandler>();

export function registerAgent(id: string, handler: AgentHandler): void {
  agents.set(id, handler);
}

export function getAgent(id: string): AgentHandler | undefined {
  return agents.get(id);
}

export function listAgents(): string[] {
  return Array.from(agents.keys());
}
