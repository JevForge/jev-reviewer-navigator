import type { JevProvider, JevProviderOptions, EvaluationRequest } from './contract.js';
import { decisionFromEvaluation, isSchemaRejected, unavailableDecision } from './normalize.js';
import { summarizeState } from './questions.js';

type EvaluateBody = {
  answers?: Record<string, { type?: string; probability?: number; confidence?: number }>;
  confidence?: Record<string, number>;
};

export function createCustomCompatibleProvider(options: JevProviderOptions): JevProvider {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'custom-compatible',
    async evaluateReviewerSelection(request: EvaluationRequest) {
      if (!options.apiKey) {
        return unavailableDecision(
          'custom-compatible',
          'JEV_CUSTOM_API_KEY is required for custom-compatible',
        );
      }
      if (!options.endpoint) {
        return unavailableDecision(
          'custom-compatible',
          'jev_endpoint is required for custom-compatible',
        );
      }
      if (!options.endpoint.startsWith('https://')) {
        return unavailableDecision(
          'custom-compatible',
          'jev_endpoint must be HTTPS for custom-compatible',
        );
      }
      if (!options.model) {
        return unavailableDecision(
          'custom-compatible',
          'jev_model is required for custom-compatible',
        );
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs);
        const response = await fetchImpl(options.endpoint, {
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
            'custom-compatible',
            `custom-compatible HTTP ${response.status}`,
          );
        }
        const body = (await response.json()) as EvaluateBody;
        return decisionFromEvaluation(
          {
            provider: 'custom-compatible',
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
        return unavailableDecision(
          'custom-compatible',
          `custom-compatible error: ${message}`,
        );
      }
    },
  };
}
