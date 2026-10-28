export type LocalReviewTrace = { events: Array<{ id: string; type: string; content: string; references?: string[] }> };
export type AIReview = { claimId: string; assessment: 'supported' | 'contradicted' | 'insufficient'; evidenceIds: string[]; reason: string };
export function buildReviewPrompt(trace: LocalReviewTrace): string;
export function validateReviewResponse(raw: string, trace: LocalReviewTrace): AIReview[];
