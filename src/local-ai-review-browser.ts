import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';
import { reviewTraceClaims, type AIReview, type LocalReviewTrace } from './local-ai-review.mjs';

// Natural-language-inference cross-encoder (Apache-2.0 upstream: cross-encoder/nli-deberta-v3-base).
// The previous generative SmolLM2-135M model never returned the required JSON in
// real runs and, even when constrained to the three labels, chose "supported" for
// contradictions. An NLI classifier outputs exactly three label scores, so there is
// no free text to parse or truncate.
export const MODEL_ID = 'Xenova/nli-deberta-v3-base';
let classifierPromise: ReturnType<typeof createClassifier> | undefined;

async function createClassifier() {
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { dtype: 'q8' }),
  ]);
  return { tokenizer, model };
}

export async function analyzeTraceLocally(trace: LocalReviewTrace): Promise<AIReview[]> {
  classifierPromise ??= createClassifier();
  let classifier: Awaited<typeof classifierPromise>;
  try {
    classifier = await classifierPromise;
  } catch (error) {
    classifierPromise = undefined; // Allow a retry after a failed download.
    throw error;
  }
  const { tokenizer, model } = classifier;
  return reviewTraceClaims(
    trace,
    async (premise, hypothesis) => {
      const inputs = tokenizer(premise, { text_pair: hypothesis, truncation: true });
      const { logits } = await model(inputs);
      const { id2label } = model.config as { id2label?: Record<string, string> };
      return { logits: Array.from(logits.data as ArrayLike<number>), id2label: id2label ?? {} };
    },
    (claimId, error) => {
      // Log metadata only. Never log the trace or model input content.
      console.warn('[PHANTOM TRACE] Local AI response rejected', {
        claimId,
        error: error instanceof Error ? error.message : 'Unknown validation error',
      });
    },
  );
}
