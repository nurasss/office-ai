import { mulRate, validationError, Usd, env } from '@ai-company/shared'
import type { TokenUsage } from './types.js'

export interface ModelPricing {
  inputPerMillion: string
  outputPerMillion: string
  cachedInputPerMillion: string | null
  pricingVerified: boolean
}

export function computeCost(usage: TokenUsage, pricing: ModelPricing): Usd {
  if (usage.cachedInputTokens > usage.inputTokens) {
    throw validationError({
      cachedInputTokens: `cachedInputTokens (${usage.cachedInputTokens}) cannot exceed inputTokens (${usage.inputTokens})`,
    })
  }

  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens
  const uncachedInputCost = mulRate(uncachedInputTokens, pricing.inputPerMillion)

  let cachedInputCost = Usd.zero()
  if (usage.cachedInputTokens > 0) {
    const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion
    cachedInputCost = mulRate(usage.cachedInputTokens, cachedRate)
  }

  const outputCost = mulRate(usage.outputTokens, pricing.outputPerMillion)

  return uncachedInputCost.add(cachedInputCost).add(outputCost)
}

export function assertPricingUsable(pricing: ModelPricing, modelKey: string): void {
  if (!pricing.pricingVerified && !env.ALLOW_UNVERIFIED_MODEL_PRICING) {
    throw validationError({
      modelKey: `Model pricing for '${modelKey}' is unverified and ALLOW_UNVERIFIED_MODEL_PRICING is false`,
    })
  }
}
