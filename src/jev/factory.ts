import type { JevProviderId } from '../schemas/enums.js';
import type { JevProvider, JevProviderOptions } from './contract.js';
import { createVercelAiGatewayProvider } from './vercel-ai-gateway.js';
import { createTypesafeNativeProvider } from './typesafe-native.js';
import { createCustomCompatibleProvider } from './custom-compatible.js';

export interface CreateJevProviderInput extends JevProviderOptions {
  provider: JevProviderId;
}

/**
 * Factory for Jev access providers.
 * Never silently falls back to another provider.
 */
export function createJevProvider(input: CreateJevProviderInput): JevProvider {
  switch (input.provider) {
    case 'vercel-ai-gateway':
      return createVercelAiGatewayProvider(input);
    case 'typesafe-native':
      return createTypesafeNativeProvider(input);
    case 'custom-compatible':
      return createCustomCompatibleProvider(input);
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`Unsupported jev_provider: ${String(_exhaustive)}`);
    }
  }
}

export { credentialEnvName } from './contract.js';
