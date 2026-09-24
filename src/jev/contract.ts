import type { JevProviderId } from '../schemas/enums.js';
import type { NavigatorDecision, ReviewerCandidate } from '../schemas/navigator.js';

export interface ReviewerEvaluationState {
  changed_paths: string[];
  affected_projects?: string[];
  paths_truncated: boolean;
  labels: string[];
  author: string | null;
  max_reviewers: number;
  candidates: ReviewerCandidate[];
  note: string;
}

export interface EvaluationRequest {
  state: ReviewerEvaluationState;
  questions: Record<string, { type: 'boolean'; instructions: string }>;
  keyToReviewer: Map<string, string>;
}

export interface JevProvider {
  readonly id: JevProviderId;
  evaluateReviewerSelection(request: EvaluationRequest): Promise<NavigatorDecision>;
}

export interface JevProviderOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  evaluateImpl?: (args: {
    model: unknown;
    state: unknown;
    questions: unknown;
    maxRetries: number;
    abortSignal: AbortSignal;
    providerOptions?: unknown;
  }) => Promise<{
    answers: Record<string, { type?: string; probability?: number; confidence?: number }>;
    providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
  }>;
}

export function credentialEnvName(provider: JevProviderId): string {
  switch (provider) {
    case 'vercel-ai-gateway':
      return 'AI_GATEWAY_API_KEY';
    case 'typesafe-native':
      return 'TYPESAFE_API_KEY';
    case 'custom-compatible':
      return 'JEV_CUSTOM_API_KEY';
  }
}
