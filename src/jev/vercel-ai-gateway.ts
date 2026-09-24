import { createGateway, experimental_evaluate as evaluate } from 'ai';
import type { JevProvider, JevProviderOptions, EvaluationRequest } from './contract.js';
import { decisionFromEvaluation, isSchemaRejected, unavailableDecision } from './normalize.js';
import { summarizeState } from './questions.js';

export function createVercelAiGatewayProvider(options: JevProviderOptions): JevProvider {
  const evaluateImpl =
    options.evaluateImpl ??
    (evaluate as NonNullable<JevProviderOptions['evaluateImpl']>);
  const modelId = options.model || 'typesafe-ai/jev';

  return {
    id: 'vercel-ai-gateway',
    async evaluateReviewerSelection(request: EvaluationRequest) {
      if (!options.apiKey) {
        return unavailableDecision(
          'vercel-ai-gateway',
          'AI_GATEWAY_API_KEY is required for vercel-ai-gateway',
        );
      }
      try {
        const gateway = createGateway({ apiKey: options.apiKey });
        const result = await evaluateImpl({
          model: gateway.evaluationModel(modelId as never),
          state: summarizeState(request.state),
          questions: request.questions,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(options.timeoutMs),
          providerOptions: { gateway: { zeroDataRetention: true } },
        });
        const typesafe = result.providerMetadata?.typesafe?.confidence;
        return decisionFromEvaluation(
          {
            provider: 'vercel-ai-gateway',
            modelLabel: modelId,
            answers: result.answers,
            confidence: typesafe,
          },
          request.state,
          request.keyToReviewer,
          request.state.max_reviewers,
        );
      } catch (error) {
        if (isSchemaRejected(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return unavailableDecision(
          'vercel-ai-gateway',
          `vercel-ai-gateway error: ${message}`,
        );
      }
    },
  };
}
