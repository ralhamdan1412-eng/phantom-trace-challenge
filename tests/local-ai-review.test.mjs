import test from 'node:test';
import assert from 'node:assert/strict';
import { assessClaimFromNli, collectClaimEvidence, FAIL_CLOSED_REASON, nliProbabilities, reviewTraceClaims, validateReviewResponse } from '../src/local-ai-review.mjs';
const trace = { events: [
  { id: 'EV-001', type: 'tool', time: '2026-01-01T00:00:00Z', content: 'status: failed; permission denied', references: [] },
  { id: 'EV-002', type: 'claim', time: '2026-01-01T00:01:00Z', content: 'The task completed successfully.', references: ['EV-001'] },
  { id: 'EV-003', type: 'claim', time: '2026-01-01T00:02:00Z', content: 'The report was exported.', references: ['EV-404'] },
  { id: 'EV-004', type: 'tool', time: '2026-01-01T00:03:00Z', content: 'Health check passed for service A.', references: [] },
  { id: 'EV-005', type: 'claim', time: '2026-01-01T00:04:00Z', content: 'Service A passed its health check.', references: ['EV-004'] },
] };
// Label order used by the cross-encoder/nli-deberta-v3 models.
const ID2LABEL = { 0: 'contradiction', 1: 'entailment', 2: 'neutral' };
const CONTRADICTION = { logits: [6, -3, -1], id2label: ID2LABEL };
const ENTAILMENT = { logits: [-3, 6, -1], id2label: ID2LABEL };
const NEUTRAL = { logits: [-1, -2, 5], id2label: ID2LABEL };
const byPremise = (map) => async (premise) => {
  const output = map[premise];
  if (output instanceof Error) throw output;
  return output;
};

test('accepts valid reviews and normalizes the result', () => { assert.deepEqual(validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output says permission was denied.' }] }), trace), [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output says permission was denied.' }]); });
test('rejects unknown claims and invented evidence IDs', () => { assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-999', assessment: 'supported', evidenceIds: ['EV-001'], reason: 'x' }] }), trace), /unknown claim ID/); assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'supported', evidenceIds: ['EV-999'], reason: 'x' }] }), trace), /unknown evidence ID/); });
test('rejects evidence that is not cited and malformed model output', () => { assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'supported', evidenceIds: ['EV-003'], reason: 'x' }] }), trace), /not referenced/); assert.throws(() => validateReviewResponse('not json', trace), /valid JSON/); });

test('accepts a supported control claim with its cited tool evidence', () => { assert.equal(validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-005', assessment: 'supported', evidenceIds: ['EV-004'], reason: 'The tool event records a passing health check.' }] }), trace)[0].assessment, 'supported'); });


test('extracts one valid review object from common model wrappers', () => {
  const review = { reviews: [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output records a permission denial.' }] };
  const json = JSON.stringify(review);
  assert.deepEqual(validateReviewResponse(`Here is the review:\n${json}\nEnd of response.`, trace), [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output records a permission denial.' }]);
  assert.deepEqual(validateReviewResponse(`\`\`\`json\n${json}\n\`\`\``, trace), [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output records a permission denial.' }]);
});

test('does not accept incomplete, ambiguous, or schema-invalid model output', () => {
  assert.throws(() => validateReviewResponse('{"reviews":[', trace), /valid JSON|incomplete|malformed/);
  const valid = JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'supported', evidenceIds: ['EV-001'], reason: 'Example.' }] });
  assert.throws(() => validateReviewResponse(`${valid}\n${valid}`, trace), /multiple JSON review objects/);
  assert.throws(() => validateReviewResponse('Answer: {"reviews":[{"claimId":"EV-002","assessment":"unknown","evidenceIds":["EV-001"],"reason":"x"}]}', trace), /unsupported assessment/);
});

test('accepts one strict single-review object even when the small model adds a short preamble', () => {
  const direct = JSON.stringify({
    claimId: 'EV-002',
    assessment: 'contradicted',
    evidenceIds: ['EV-001'],
    reason: 'The cited tool output records a permission denial.'
  });
  assert.deepEqual(
    validateReviewResponse(`Review result:\n${direct}`, trace),
    [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The cited tool output records a permission denial.' }]
  );
});

test('does not accept multiple direct review objects or a direct object with extra fields', () => {
  const direct = JSON.stringify({
    claimId: 'EV-002', assessment: 'contradicted',
    evidenceIds: ['EV-001'], reason: 'Permission was denied.'
  });
  assert.throws(() => validateReviewResponse(`${direct}\n${direct}`, trace), /multiple JSON review objects/);
  assert.throws(() => validateReviewResponse(JSON.stringify({ ...JSON.parse(direct), confidence: 0.9 }), trace), /valid JSON/);
});

// Regression: real SmolLM2-135M output was repetitive prose with no JSON.
test('rejects unstructured explanatory text from a model', () => {
  const prose = 'You are a helpful AI named SmolLM, trained by Hugging Face.\n\n"CLAIM_ID: 005"\n"ASSESSMENT: INSUFFICENT"\n"ASSESSED: 004"';
  assert.throws(() => validateReviewResponse(prose, trace), /valid JSON/);
  assert.throws(() => validateReviewResponse('', trace), /empty response/);
});

test('rejects truncated JSON', () => {
  assert.throws(() => validateReviewResponse('{"claimId":"EV-002","assessment":"contradicted","evidenceIds":["EV-0', trace), /valid JSON/);
  assert.throws(() => validateReviewResponse('{"reviews":[{"claimId":"EV-002","assessment":"contradicted"', trace), /valid JSON/);
});

test('rejects reviews with missing fields', () => {
  // Regression: real SmolLM2-360M output omitted the reason field.
  assert.throws(() => validateReviewResponse('{"claimId":"EV-002","assessment":"insufficient","evidenceIds":[]}', trace), /valid JSON/);
  assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'] }] }), trace), /no explanation/);
  assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', evidenceIds: ['EV-001'], reason: 'x' }] }), trace), /unsupported assessment/);
  assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'contradicted', reason: 'x' }] }), trace), /invalid evidence list/);
});

// Regression: real Qwen2.5-0.5B output labelled EV-003 "supported" with no evidence and was accepted.
test('rejects a supported or contradicted verdict without cited evidence', () => {
  assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-003', assessment: 'supported', evidenceIds: [], reason: 'The evidence does not support the claim.' }] }), trace), /without cited evidence/);
  assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-003', assessment: 'supported', evidenceIds: ['EV-404'], reason: 'x' }] }), trace), /unknown evidence ID/);
  assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001', 'EV-001'], reason: 'x' }] }), trace), /duplicate evidence IDs/);
});

test('collects only existing, explicitly referenced evidence for a claim', () => {
  assert.deepEqual(collectClaimEvidence(trace, 'EV-005').evidence.map((event) => event.id), ['EV-004']);
  const missing = collectClaimEvidence(trace, 'EV-003');
  assert.deepEqual(missing.evidence, []);
  assert.deepEqual(missing.missingReferences, ['EV-404']);
  assert.throws(() => collectClaimEvidence(trace, 'EV-001'), /not in the reviewable claim set/);
});

test('maps NLI logits to assessments using the model label map, not label order', () => {
  const probabilities = nliProbabilities([6, -3, -1], ID2LABEL);
  assert.ok(probabilities.contradicted > 0.99);
  const reordered = nliProbabilities([-3, 6, -1], { 0: 'ENTAILMENT', 1: 'CONTRADICTION', 2: 'NEUTRAL' });
  assert.ok(reordered.contradicted > 0.99);
  assert.ok(Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
});

test('rejects malformed NLI classifier output', () => {
  assert.throws(() => nliProbabilities([1, 2], ID2LABEL), /invalid classification output/);
  assert.throws(() => nliProbabilities([1, Number.NaN, 2], ID2LABEL), /invalid classification output/);
  assert.throws(() => nliProbabilities([1, 2, 3], { 0: 'positive', 1: 'negative', 2: 'neutral' }), /invalid classification output/);
  assert.throws(() => nliProbabilities([1, 2, 3], { 0: 'entailment', 1: 'entailment', 2: 'neutral' }), /invalid classification output/);
  assert.throws(() => nliProbabilities(undefined, ID2LABEL), /invalid classification output/);
});

test('reports a low-confidence NLI label as insufficient with no cited evidence', () => {
  const review = assessClaimFromNli(trace, 'EV-005', [{ evidenceId: 'EV-004', probabilities: { supported: 0.6, contradicted: 0.1, insufficient: 0.3 } }]);
  assert.equal(review.assessment, 'insufficient');
  assert.deepEqual(review.evidenceIds, []);
  assert.match(review.reason, /EV-004: supported p=0\.60/);
});

test('rejects an evidence score for an event the claim does not cite', () => {
  assert.throws(() => assessClaimFromNli(trace, 'EV-005', [{ evidenceId: 'EV-001', probabilities: { supported: 0.99, contradicted: 0, insufficient: 0.01 } }]), /invalid evidence score/);
  assert.throws(() => assessClaimFromNli(trace, 'EV-005', []), /did not score every cited evidence event/);
});

test('reviews EV-002, EV-003 and EV-005 from valid model output', async () => {
  const calls = [];
  const reviews = await reviewTraceClaims(trace, async (premise, hypothesis) => {
    calls.push([premise, hypothesis]);
    return byPremise({ 'status: failed; permission denied': CONTRADICTION, 'Health check passed for service A.': ENTAILMENT })(premise);
  });
  assert.deepEqual(reviews.map(({ claimId, assessment, evidenceIds }) => ({ claimId, assessment, evidenceIds })), [
    { claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'] },
    { claimId: 'EV-003', assessment: 'insufficient', evidenceIds: [] },
    { claimId: 'EV-005', assessment: 'supported', evidenceIds: ['EV-004'] },
  ]);
  assert.match(reviews[0].reason, /EV-001 contradicts the claim/);
  assert.match(reviews[1].reason, /missing: EV-404/);
  // EV-003 cites no existing event, so the model is not asked to judge it.
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['status: failed; permission denied', 'The task completed successfully.']);
});

test('reports a neutral NLI result as insufficient', async () => {
  const reviews = await reviewTraceClaims(trace, async () => NEUTRAL);
  assert.equal(reviews[0].assessment, 'insufficient');
  assert.deepEqual(reviews[0].evidenceIds, []);
  assert.notEqual(reviews[0].reason, FAIL_CLOSED_REASON);
});

test('a failure on one claim does not change the other claims', async () => {
  const rejected = [];
  const reviews = await reviewTraceClaims(trace, byPremise({
    'status: failed; permission denied': new Error('model crashed'),
    'Health check passed for service A.': ENTAILMENT,
  }), (claimId, error) => rejected.push([claimId, error.message]));
  assert.deepEqual(rejected, [['EV-002', 'model crashed']]);
  assert.deepEqual(reviews[0], { claimId: 'EV-002', assessment: 'insufficient', evidenceIds: [], reason: FAIL_CLOSED_REASON });
  assert.equal(reviews[2].assessment, 'supported');
  assert.deepEqual(reviews[2].evidenceIds, ['EV-004']);
});

test('malformed model output fails closed for that claim only', async () => {
  const reviews = await reviewTraceClaims(trace, byPremise({
    'status: failed; permission denied': { logits: [Number.NaN, 1, 2], id2label: ID2LABEL },
    'Health check passed for service A.': ENTAILMENT,
  }));
  assert.equal(reviews[0].reason, FAIL_CLOSED_REASON);
  assert.equal(reviews[0].assessment, 'insufficient');
  assert.equal(reviews[2].assessment, 'supported');
});

test('contradicting cited evidence outweighs supporting cited evidence', async () => {
  const mixed = { events: [
    { id: 'A', type: 'tool', time: '2026-01-01T00:00:00Z', content: 'Region 1 deploy ok.' },
    { id: 'B', type: 'tool', time: '2026-01-01T00:00:01Z', content: 'Region 2 deploy failed.' },
    { id: 'C', type: 'claim', time: '2026-01-01T00:00:02Z', content: 'Deploy succeeded everywhere.', references: ['A', 'B'] },
  ] };
  const [review] = await reviewTraceClaims(mixed, byPremise({ 'Region 1 deploy ok.': ENTAILMENT, 'Region 2 deploy failed.': CONTRADICTION }));
  assert.equal(review.assessment, 'contradicted');
  assert.deepEqual(review.evidenceIds, ['B']);
});
