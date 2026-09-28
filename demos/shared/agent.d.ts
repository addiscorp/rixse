export type AgentTiming = { readBody: number; buildPrompt: number; firstToken: number | null; model: number; server: number };
export type AgentEvent =
  | { kind: 'say'; say: string }
  | { kind: 'action'; action: { type: string; payload?: unknown } }
  | { kind: 'done'; model?: string; usage?: { input: number; output: number }; timing?: AgentTiming; lines?: number; actions?: number; raw?: string }
  | { kind: 'error'; error: string };

export declare function streamAgent(endpoint: string, body: unknown, onEvent: (ev: AgentEvent) => void): Promise<void>;
