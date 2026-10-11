import { notFound } from '@ai-company/shared'
import type { ModelProvider } from './provider.js'

export interface ProviderRegistry {
  register(provider: ModelProvider): void
  get(name: string): ModelProvider
  has(name: string): boolean
  list(): string[]
}

export function createProviderRegistry(): ProviderRegistry {
  const providers = new Map<string, ModelProvider>()

  return {
    register(provider: ModelProvider): void {
      providers.set(provider.name, provider)
    },
    get(name: string): ModelProvider {
      const provider = providers.get(name)
      if (!provider) {
        throw notFound('PROVIDER_NOT_FOUND', `Model provider '${name}' is not registered`)
      }
      return provider
    },
    has(name: string): boolean {
      return providers.has(name)
    },
    list(): string[] {
      return Array.from(providers.keys())
    },
  }
}
