import { pipeline } from '@huggingface/transformers';
import { buildReviewPrompt, validateReviewResponse, type AIReview, type LocalReviewTrace } from './local-ai-review.mjs';

export const MODEL_ID = 'HuggingFaceTB/SmolLM2-135M-Instruct';
let generatorPromise: ReturnType<typeof createGenerator> | undefined;

async function createGenerator() {
  return pipeline('text-generation', MODEL_ID, { dtype: 'q4' });
}

export async function analyzeTraceLocally(trace: LocalReviewTrace): Promise<AIReview[]> {
  generatorPromise ??= createGenerator();
  const generator = await generatorPromise;
  const messages: { role: 'user'; content: string }[] = [{ role: 'user', content: buildReviewPrompt(trace) }];
  const output = await generator(messages, { max_new_tokens: 280, do_sample: false });
  const generated = output[0]?.generated_text;
  const lastContent = typeof generated === 'string' ? generated : generated.at(-1)?.content;
  const response = typeof lastContent === 'string'
    ? lastContent
    : Array.isArray(lastContent)
      ? lastContent.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String(part.text ?? '') : '').join('')
      : '';
  return validateReviewResponse(response, trace);
}
