import { z } from 'zod'
import { AppError } from '@ai-company/shared'
import type { ModelInput, ModelOutput } from './types.js'
import type { ModelProvider } from './provider.js'

export interface StructuredOutputOptions<T> {
  name: string
  description?: string
  schema: z.ZodType<T>
  input: Omit<ModelInput, 'tools' | 'toolChoice'>
  jsonSchema?: Record<string, unknown>
}

export async function generateStructuredOutput<T>(
  provider: ModelProvider,
  options: StructuredOutputOptions<T>,
  signal?: AbortSignal,
): Promise<{ data: T; raw: ModelOutput }> {
  const inputSchema = options.jsonSchema ?? {
    type: 'object',
    properties: {},
  }

  const modelInput: ModelInput = {
    ...options.input,
    tools: [
      {
        name: options.name,
        description: options.description ?? `Structured output tool for ${options.name}`,
        inputSchema,
      },
    ],
    toolChoice: { name: options.name },
  }

  const raw = await provider.generate(modelInput, signal)

  const toolCall = raw.content.find(
    (c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      c.type === 'tool_use' && c.name === options.name,
  )

  if (!toolCall) {
    throw new AppError({
      code: 'STRUCTURED_OUTPUT_FAILED',
      httpStatus: 400,
      message: `Model did not return tool call '${options.name}'`,
      details: { toolName: options.name },
    })
  }

  const parseResult = options.schema.safeParse(toolCall.input)
  if (!parseResult.success) {
    throw new AppError({
      code: 'STRUCTURED_OUTPUT_FAILED',
      httpStatus: 400,
      message: `Structured output validation failed: ${parseResult.error.message}`,
      details: { issues: parseResult.error.issues },
    })
  }

  return {
    data: parseResult.data,
    raw,
  }
}
