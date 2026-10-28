import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, validateReviewResponse } from '../src/local-ai-review.mjs';
const trace = { events: [
  { id: 'EV-001', type: 'tool', time: '2026-01-01T00:00:00Z', content: 'status: failed; permission denied', references: [] },
  { id: 'EV-002', type: 'claim', time: '2026-01-01T00:01:00Z', content: 'The task completed successfully.', references: ['EV-001'] },
  { id: 'EV-003', type: 'claim', time: '2026-01-01T00:02:00Z', content: 'The report was exported.', references: ['EV-404'] },
  { id: 'EV-004', type: 'tool', time: '2026-01-01T00:03:00Z', content: 'Health check passed for service A.', references: [] },
  { id: 'EV-005', type: 'claim', time: '2026-01-01T00:04:00Z', content: 'Service A passed its health check.', references: ['EV-004'] },
] };
test('builds a bounded review prompt with citation rules', () => { const prompt = buildReviewPrompt(trace); assert.match(prompt, /EV-001/); assert.match(prompt, /contradicted/); assert.ok(prompt.length < 10000); });
test('accepts valid reviews and normalizes the result', () => { assert.deepEqual(validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output says permission was denied.' }] }), trace), [{ claimId: 'EV-002', assessment: 'contradicted', evidenceIds: ['EV-001'], reason: 'The tool output says permission was denied.' }]); });
test('rejects unknown claims and invented evidence IDs', () => { assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-999', assessment: 'supported', evidenceIds: ['EV-001'], reason: 'x' }] }), trace), /unknown claim ID/); assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'supported', evidenceIds: ['EV-999'], reason: 'x' }] }), trace), /unknown evidence ID/); });
test('rejects evidence that is not cited and malformed model output', () => { assert.throws(() => validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-002', assessment: 'supported', evidenceIds: ['EV-003'], reason: 'x' }] }), trace), /not referenced/); assert.throws(() => validateReviewResponse('not json', trace), /valid JSON/); });

test('accepts a supported control claim with its cited tool evidence', () => { assert.equal(validateReviewResponse(JSON.stringify({ reviews: [{ claimId: 'EV-005', assessment: 'supported', evidenceIds: ['EV-004'], reason: 'The tool event records a passing health check.' }] }), trace)[0].assessment, 'supported'); });
