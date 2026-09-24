import type { JevProvider, JevProviderOptions, EvaluationRequest } from './contract.js';
import { decisionFromEvaluation, isSchemaRejected, unavailableDecision } from './normalize.js';
import { summarizeState } from './questions.js';

type EvaluateBody = {
  answers?: Record<string, { type?: string; probability?: number; confidence?: number }>;
  confidence?: Record<string, number>;
};

export function createTypesafeNativeProvider(options: JevProviderOptions): JevProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.typesafe.ai/v1/evaluate';

  return {
    id: 'typesafe-native',
    async evaluateReviewerSelection(request: EvaluationRequest) {
      if (!options.apiKey) {
        return unavailableDecision(
          'typesafe-native',
          'TYPESAFE_API_KEY is required for typesafe-native',
        );
      }
      if (!options.model) {
        return unavailableDecision(
          'typesafe-native',
          'jev_model is required for typesafe-native (pin a catalog model id)',
        );
      }
      if (!endpoint.startsWith('https://')) {
        return unavailableDecision(
          'typesafe-native',
          'jev_endpoint must be HTTPS for typesafe-native',
        );
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs);
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            state: summarizeState(request.state),
            questions: request.questions,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          return unavailableDecision(
            'typesafe-native',
            `typesafe-native HTTP ${response.status}`,
          );
        }
        const body = (await response.json()) as EvaluateBody;
        return decisionFromEvaluation(
          {
            provider: 'typesafe-native',
            modelLabel: options.model,
            answers: body.answers ?? {},
            confidence: body.confidence,
          },
          request.state,
          request.keyToReviewer,
          request.state.max_reviewers,
        );
      } catch (error) {
        if (isSchemaRejected(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return unavailableDecision('typesafe-native', `typesafe-native error: ${message}`);
      }
    },
  };
}
