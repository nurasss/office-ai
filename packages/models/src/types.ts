export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }

export interface Message {
  role: 'user' | 'assistant'
  content: ContentPart[]
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ModelInput {
  provider: 'openai' | 'anthropic' | 'google'
  modelKey: string
  system?: string
  messages: Message[]
  tools?: ToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required' | { name: string }
  temperature?: number
  maxOutputTokens: number
  stopSequences?: string[]
  timeoutMs?: number
  metadata?: { orgId: string; agentId?: string; requestId: string }
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'stop_sequence'
  | 'content_filter'
  | 'error'

export interface ModelOutput {
  content: ContentPart[]
  stopReason: StopReason
  usage: TokenUsage
  latencyMs: number
  modelKey: string
  provider: string
}
