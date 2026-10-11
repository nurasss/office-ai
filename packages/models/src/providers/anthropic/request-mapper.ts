import type Anthropic from '@anthropic-ai/sdk'
import type { ModelInput, ContentPart } from '../../types.js'
import { ProviderError } from '../../errors.js'

export function validateAndMapAnthropicRequest(
  input: ModelInput,
): Anthropic.MessageCreateParamsNonStreaming {
  if (!input.messages || input.messages.length === 0) {
    throw new ProviderError({
      kind: 'invalid_request',
      provider: 'anthropic',
      message: 'Messages array cannot be empty',
    })
  }

  for (let i = 0; i < input.messages.length; i++) {
    const msg = input.messages[i]!
    if (!msg.content || msg.content.length === 0) {
      throw new ProviderError({
        kind: 'invalid_request',
        provider: 'anthropic',
        message: `Message at index ${i} has empty content`,
      })
    }

    if (i > 0) {
      const prevMsg = input.messages[i - 1]!
      if (msg.role === prevMsg.role) {
        throw new ProviderError({
          kind: 'invalid_request',
          provider: 'anthropic',
          message: `Consecutive messages cannot have the same role '${msg.role}' at index ${i}`,
        })
      }
    }

    for (const part of msg.content) {
      if (part.type === 'tool_result') {
        if (i === 0) {
          throw new ProviderError({
            kind: 'invalid_request',
            provider: 'anthropic',
            message: `tool_result with id '${part.toolUseId}' cannot appear in the first message`,
          })
        }
        const prevMsg = input.messages[i - 1]!
        if (prevMsg.role !== 'assistant') {
          throw new ProviderError({
            kind: 'invalid_request',
            provider: 'anthropic',
            message: `tool_result with id '${part.toolUseId}' must be preceded by an assistant message`,
          })
        }
        const hasMatchingToolUse = prevMsg.content.some(
          (p) => p.type === 'tool_use' && p.id === part.toolUseId,
        )
        if (!hasMatchingToolUse) {
          throw new ProviderError({
            kind: 'invalid_request',
            provider: 'anthropic',
            message: `tool_result with id '${part.toolUseId}' has no matching tool_use in preceding assistant message`,
          })
        }
      }
    }
  }

  const lastMsg = input.messages[input.messages.length - 1]!
  if (lastMsg.role === 'assistant') {
    throw new ProviderError({
      kind: 'invalid_request',
      provider: 'anthropic',
      message: 'Last message cannot be from assistant',
    })
  }

  const anthropicMessages: Anthropic.MessageParam[] = input.messages.map((msg) => {
    const blocks: Anthropic.ContentBlockParam[] = msg.content.map((part: ContentPart) => {
      switch (part.type) {
        case 'text':
          return {
            type: 'text',
            text: part.text,
          }
        case 'tool_use':
          return {
            type: 'tool_use',
            id: part.id,
            name: part.name,
            input: part.input,
          }
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: part.toolUseId,
            content: part.content,
            is_error: part.isError,
          }
      }
    })

    return {
      role: msg.role,
      content: blocks,
    }
  })

  let toolChoice: Anthropic.MessageCreateParamsNonStreaming['tool_choice'] | undefined
  if (input.toolChoice) {
    if (typeof input.toolChoice === 'string') {
      switch (input.toolChoice) {
        case 'auto':
          toolChoice = { type: 'auto' }
          break
        case 'none':
          toolChoice = { type: 'none' }
          break
        case 'required':
          toolChoice = { type: 'any' }
          break
      }
    } else if (typeof input.toolChoice === 'object' && input.toolChoice.name) {
      toolChoice = { type: 'tool', name: input.toolChoice.name }
    }
  }

  const tools: Anthropic.Tool[] | undefined =
    input.tools && input.tools.length > 0
      ? input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        }))
      : undefined

  const payload: Anthropic.MessageCreateParamsNonStreaming = {
    model: input.modelKey,
    messages: anthropicMessages,
    max_tokens: input.maxOutputTokens,
    ...(input.system ? { system: input.system } : {}),
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.stopSequences && input.stopSequences.length > 0
      ? { stop_sequences: input.stopSequences }
      : {}),
  }

  return payload
}
