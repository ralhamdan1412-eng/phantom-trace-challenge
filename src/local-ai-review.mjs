const CLAIM_TYPES = new Set(['claim', 'assertion', 'final']);
const ASSESSMENTS = new Set(['supported', 'contradicted', 'insufficient']);
const MAX_CLAIMS = 6;
const MAX_EVIDENCE_PER_CLAIM = 4;
const MAX_EVENT_CHARS = 500;
// A supported or contradicted label below this probability is reported as
// insufficient: a weak model signal is never presented as a verdict.
export const MIN_NLI_CONFIDENCE = 0.8;
// The review model is a natural-language-inference classifier. Its three
// labels map one-to-one onto the assessments this app reports.
const NLI_LABELS = { entailment: 'supported', contradiction: 'contradicted', neutral: 'insufficient' };
export const FAIL_CLOSED_REASON = 'Automated assessment unavailable: the local model did not return a verifiable structured response. Manual evidence review is required.';

function cleanEvent(event) {
  return { id: event.id, type: event.type, content: String(event.content ?? '').slice(0, MAX_EVENT_CHARS), references: Array.isArray(event.references) ? event.references.slice(0, 8) : [] };
}

function reviewableClaims(events) {
  return events.filter((event) => CLAIM_TYPES.has(String(event.type).toLowerCase())).slice(0, MAX_CLAIMS);
}

/** Pair one claim with the evidence events it explicitly references and that exist in the trace. */
export function collectClaimEvidence(trace, claimId) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const claim = reviewableClaims(events).find((event) => event.id === claimId);
  if (!claim) throw new Error('The requested claim is not in the reviewable claim set.');
  const references = Array.isArray(claim.references) ? claim.references : [];
  const evidence = [...new Set(references)]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_PER_CLAIM)
    .map(cleanEvent);
  return { claim: cleanEvent(claim), evidence, missingReferences: references.filter((id) => !byId.has(id)) };
}

/** Convert raw NLI classifier logits into probabilities keyed by assessment. */
export function nliProbabilities(logits, id2label) {
  const values = Array.from(logits ?? [], Number);
  const labels = values.map((_, index) => NLI_LABELS[String(id2label?.[index] ?? '').toLowerCase()]);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value)) || labels.includes(undefined) || new Set(labels).size !== 3) {
    throw new Error('The local model returned an invalid classification output.');
  }
  const max = Math.max(...values);
  const exp = values.map((value) => Math.exp(value - max));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(labels.map((label, index) => [label, exp[index] / total]));
}

/** Build one claim review from per-evidence NLI probabilities and pass it through the strict validator. */
export function assessClaimFromNli(trace, claimId, evidenceScores) {
  const { evidence, missingReferences } = collectClaimEvidence(trace, claimId);
  if (!Array.isArray(evidenceScores) || evidenceScores.length !== evidence.length) {
    throw new Error('The local model did not score every cited evidence event.');
  }
  const scored = evidenceScores.map((score, index) => {
    const probabilities = score?.probabilities;
    if (score?.evidenceId !== evidence[index].id || !probabilities
      || [...ASSESSMENTS].some((label) => !Number.isFinite(probabilities[label]) || probabilities[label] < 0 || probabilities[label] > 1)) {
      throw new Error('The local model returned an invalid evidence score.');
    }
    const top = [...ASSESSMENTS].reduce((best, next) => (probabilities[next] > probabilities[best] ? next : best));
    const accepted = top !== 'insufficient' && probabilities[top] >= MIN_NLI_CONFIDENCE;
    return { evidenceId: score.evidenceId, label: accepted ? top : 'insufficient', top, probability: probabilities[top] };
  });

  let review;
  if (!evidence.length) {
    const missing = missingReferences.length ? ` (missing: ${missingReferences.slice(0, 4).join(', ')})` : '';
    review = { claimId, assessment: 'insufficient', evidenceIds: [], reason: `No referenced evidence event exists in this trace${missing}; the model had nothing to compare.` };
  } else {
    // A cited contradiction outweighs cited support: it is the signal an auditor must see.
    const assessment = scored.some((item) => item.label === 'contradicted') ? 'contradicted'
      : scored.some((item) => item.label === 'supported') ? 'supported' : 'insufficient';
    const cited = assessment === 'insufficient' ? [] : scored.filter((item) => item.label === assessment);
    const verb = assessment === 'contradicted' ? 'contradicts' : 'supports';
    const reason = assessment === 'insufficient'
      ? `Local NLI model found no cited evidence that clearly supports or contradicts the claim (${scored.map((item) => `${item.evidenceId}: ${item.top} p=${item.probability.toFixed(2)}`).join('; ')}).`
      : `Local NLI model: ${cited.map((item) => `${item.evidenceId} ${verb} the claim (p=${item.probability.toFixed(2)})`).join('; ')}.`;
    review = { claimId, assessment, evidenceIds: cited.map((item) => item.evidenceId), reason };
  }
  const validated = validateReviewResponse(JSON.stringify({ reviews: [review] }), trace);
  if (validated.length !== 1 || validated[0].claimId !== claimId) {
    throw new Error('The local model did not return exactly the requested claim review.');
  }
  return validated[0];
}

/**
 * Review each claim independently. `scorePair(premise, hypothesis)` runs the NLI
 * model and resolves to `{ logits, id2label }`. A failure on one claim marks only
 * that claim as unassessed and never changes the other claims' results.
 */
export async function reviewTraceClaims(trace, scorePair, onReject = () => {}) {
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const reviews = [];
  for (const claim of reviewableClaims(events)) {
    try {
      const { claim: claimEvent, evidence } = collectClaimEvidence(trace, claim.id);
      const evidenceScores = [];
      for (const item of evidence) {
        const output = await scorePair(item.content, claimEvent.content);
        evidenceScores.push({ evidenceId: item.id, probabilities: nliProbabilities(output?.logits, output?.id2label) });
      }
      reviews.push(assessClaimFromNli(trace, claim.id, evidenceScores));
    } catch (error) {
      onReject(claim.id, error);
      // Fail closed without crashing the entire review: do not infer a verdict
      // from invalid output. Explicitly mark this claim as unassessed.
      reviews.push({ claimId: claim.id, assessment: 'insufficient', evidenceIds: [], reason: FAIL_CLOSED_REASON });
    }
  }
  return reviews;
}

function parseModelJson(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('The local model returned an empty response.');

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(unfenced);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if ('reviews' in parsed) return parsed;
      if (isSingleReviewObject(parsed)) return { reviews: [parsed] };
    }
  } catch {
    // Continue to search for one complete object in surrounding model prose.
  }

  // Find balanced JSON objects without treating braces inside strings as structure.
  const objects = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const char = text[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              objects.push({ start, end, value: parsed });
            }
          } catch {
            // Ignore malformed candidates; never infer an assessment from them.
          }
          start = end;
          break;
        }
      }
    }
  }

  // Prefer one explicit review envelope if present. Ignore nested review objects
  // within that envelope so a valid wrapper is not counted twice.
  const envelopes = objects.filter(({ value }) => 'reviews' in value);
  if (envelopes.length === 1) return envelopes[0].value;
  if (envelopes.length > 1) {
    throw new Error('The local model returned multiple JSON review objects; no assessment was accepted.');
  }

  // Accept only the exact single-review shape without a wrapper; normal
  // validation still checks claim IDs, assessment, evidence references, and reason.
  const directReviews = objects.filter(({ value }) => isSingleReviewObject(value));
  if (directReviews.length === 1) return { reviews: [directReviews[0].value] };
  if (directReviews.length > 1) {
    throw new Error('The local model returned multiple JSON review objects; no assessment was accepted.');
  }
  throw new Error('The local model did not return valid JSON. The response may be incomplete or malformed.');
}

function isSingleReviewObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 4
    && keys[0] === 'assessment'
    && keys[1] === 'claimId'
    && keys[2] === 'evidenceIds'
    && keys[3] === 'reason';
}

export function validateReviewResponse(raw, trace) {
  const value = parseModelJson(raw);
  if (!value || !Array.isArray(value.reviews) || value.reviews.length > MAX_CLAIMS) throw new Error('The local model returned an invalid reviews list.');
  const events = Array.isArray(trace?.events) ? trace.events : [];
  const byId = new Map(events.map((event) => [event.id, event]));
  const candidates = new Set(reviewableClaims(events).map((event) => event.id));
  const seenClaims = new Set();
  return value.reviews.map((review) => {
    if (!review || !candidates.has(review.claimId)) throw new Error('The local model returned an unknown claim ID.');
    if (seenClaims.has(review.claimId)) throw new Error('The local model returned a duplicate claim ID.');
    seenClaims.add(review.claimId);
    if (!ASSESSMENTS.has(review.assessment)) throw new Error('The local model returned an unsupported assessment.');
    if (!Array.isArray(review.evidenceIds) || review.evidenceIds.length > MAX_EVIDENCE_PER_CLAIM) throw new Error('The local model returned an invalid evidence list.');
    const claim = byId.get(review.claimId);
    const allowedReferences = new Set(Array.isArray(claim.references) ? claim.references : []);
    for (const evidenceId of review.evidenceIds) {
      if (!byId.has(evidenceId)) throw new Error('The local model returned an unknown evidence ID.');
      if (!allowedReferences.has(evidenceId)) throw new Error('The evidence ID is not referenced by this claim.');
    }
    if (new Set(review.evidenceIds).size !== review.evidenceIds.length) throw new Error('The local model returned duplicate evidence IDs.');
    // A verdict that is not tied to existing cited evidence is not verifiable.
    if (review.assessment !== 'insufficient' && review.evidenceIds.length === 0) {
      throw new Error('The local model returned a supported or contradicted assessment without cited evidence.');
    }
    const reason = typeof review.reason === 'string' ? review.reason.trim().slice(0, 280) : '';
    if (!reason) throw new Error('The local model returned no explanation.');
    return { claimId: review.claimId, assessment: review.assessment, evidenceIds: [...review.evidenceIds], reason };
  });
}
