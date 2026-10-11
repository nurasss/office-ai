import {
  AppError,
  notFound,
  Usd,
  type RequestContext,
  type SystemContext,
  type Clock,
  type IdGenerator,
  type Logger,
} from '@ai-company/shared'
import type {
  CatalogRepository,
  ModelInvocationRepository,
} from '@ai-company/db'
import type { ModelInput, ModelOutput } from './types.js'
import type { ProviderRegistry } from './registry.js'
import { ProviderError } from './errors.js'
import { withRetry, type RetryPolicy } from './retry.js'
import { computeCost, assertPricingUsable, type ModelPricing } from './cost.js'

export interface ExecuteDeps {
  registry: ProviderRegistry
  repos: {
    modelInvocations: ModelInvocationRepository
    catalog: CatalogRepository
  }
  clock: Clock
  ids: IdGenerator
  logger: Logger
  sleep: (ms: number) => Promise<void>
  random: () => number
}

export async function executeModelCall(
  ctx: RequestContext | SystemContext,
  input: ModelInput,
  deps: ExecuteDeps,
  retry?: Partial<RetryPolicy>,
): Promise<ModelOutput & { cost: Usd }> {
  // 1. Find model in catalog by (provider, modelKey)
  const model = await deps.repos.catalog.findModelByKey(input.provider, input.modelKey)
  if (!model) {
    throw notFound(
      'MODEL_NOT_FOUND',
      `Model '${input.modelKey}' from provider '${input.provider}' not found in catalog`,
    )
  }

  // 2. Model deprecated -> error
  if (model.status === 'deprecated') {
    throw new AppError({
      code: 'MODEL_DEPRECATED',
      httpStatus: 400,
      message: `Model '${input.modelKey}' is deprecated`,
      details: { modelKey: input.modelKey },
    })
  }

  // 3. Assert pricing is usable
  const pricing: ModelPricing = {
    inputPerMillion: model.inputPricePerMillion,
    outputPerMillion: model.outputPricePerMillion,
    cachedInputPerMillion: model.cachedInputPricePerMillion,
    pricingVerified: model.pricingVerified,
  }
  assertPricingUsable(pricing, input.modelKey)

  // 4. maxOutputTokens not greater than model limit in catalog
  if (input.maxOutputTokens > model.maxOutputTokens) {
    throw new AppError({
      code: 'MAX_OUTPUT_TOKENS_EXCEEDED',
      httpStatus: 400,
      message: `maxOutputTokens (${input.maxOutputTokens}) exceeds model limit (${model.maxOutputTokens})`,
      details: {
        requested: input.maxOutputTokens,
        limit: model.maxOutputTokens,
      },
    })
  }

  // 5. If tools provided and model does not support tools -> error
  if (input.tools && input.tools.length > 0 && !model.supportsTools) {
    throw new AppError({
      code: 'TOOLS_NOT_SUPPORTED',
      httpStatus: 400,
      message: `Model '${input.modelKey}' does not support tools`,
      details: { modelKey: input.modelKey },
    })
  }

  // 6. Get provider from registry
  const provider = deps.registry.get(input.provider)

  // 7. Timeout setup (default 120000ms)
  const timeoutMs = input.timeoutMs ?? 120000
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, timeoutMs)

  let finalCost = Usd.zero()

  try {
    const output = await withRetry(
      async (attempt: number) => {
        const attemptStart = deps.clock.now().getTime()
        try {
          const res = await provider.generate(input, abortController.signal)
          const latencyMs = deps.clock.now().getTime() - attemptStart
          const cost = computeCost(res.usage, pricing)

          await deps.repos.modelInvocations.append(ctx, {
            agentId: input.metadata?.agentId,
            provider: input.provider,
            modelKey: input.modelKey,
            modelId: model.id,
            requestId: input.metadata?.requestId ?? ctx.requestId,
            attempt,
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            cachedInputTokens: res.usage.cachedInputTokens,
            costUsd: cost,
            latencyMs,
            status: 'success',
            stopReason: res.stopReason,
            errorKind: null,
          })

          finalCost = cost
          return res
        } catch (err: unknown) {
          const latencyMs = deps.clock.now().getTime() - attemptStart
          let errorKind = 'unknown'
          let stopReason: string | null = null

          if (err instanceof ProviderError) {
            errorKind = err.kind
            stopReason = 'error'
          } else if (abortController.signal.aborted) {
            errorKind = 'timeout'
            stopReason = 'error'
          }

          try {
            await deps.repos.modelInvocations.append(ctx, {
              agentId: input.metadata?.agentId,
              provider: input.provider,
              modelKey: input.modelKey,
              modelId: model.id,
              requestId: input.metadata?.requestId ?? ctx.requestId,
              attempt,
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              costUsd: '0.000000',
              latencyMs,
              status: 'error',
              stopReason,
              errorKind,
            })
          } catch (logErr) {
            deps.logger.error({ msg: 'Failed to record model invocation error', logErr })
          }

          throw err
        }
      },
      retry,
      {
        clock: deps.clock,
        sleep: deps.sleep,
        logger: deps.logger,
        random: deps.random,
      },
    )

    return {
      ...output,
      cost: finalCost,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
