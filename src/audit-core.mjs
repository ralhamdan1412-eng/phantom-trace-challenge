/** Deterministic, browser-local audit logic. No network access or telemetry. */
export function validateTrace(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok:false, errors:['Top-level JSON must be an object.'] };
  if (!Array.isArray(input.events)) errors.push('"events" must be an array.');
  const events = Array.isArray(input.events) ? input.events : [];
  if (events.length > 10000) errors.push('Maximum supported event count is 10,000.');
  const ids = new Set();
  events.forEach((event, i) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) { errors.push(`Event ${i+1} must be an object.`); return; }
    if (typeof event.id !== 'string' || !event.id.trim()) errors.push(`Event ${i+1} requires a non-empty string id.`);
    else if (ids.has(event.id)) errors.push(`Duplicate event id: ${event.id}`); else ids.add(event.id);
    if (typeof event.type !== 'string' || !event.type.trim()) errors.push(`Event ${i+1} requires a non-empty string type.`);
    if (typeof event.time !== 'string' || !event.time.trim() || Number.isNaN(Date.parse(event.time))) errors.push(`Event ${i+1} requires a parseable time string.`);
    if (typeof event.content !== 'string') errors.push(`Event ${i+1} requires string content.`);
    if (event.references !== undefined && (!Array.isArray(event.references) || event.references.some(r => typeof r !== 'string'))) errors.push(`Event ${i+1} references must be an array of strings.`);
  });
  return { ok:errors.length===0, errors, ids };
}
export function auditTrace(trace) {
  const validation = validateTrace(trace);
  if (!validation.ok) return { valid:false, errors:validation.errors, findings:[] };
  const known = new Set(trace.events.map(e=>e.id));
  const findings = [];
  for (const event of trace.events) {
    for (const ref of event.references ?? []) {
      if (!known.has(ref)) findings.push({severity:'error', code:'MISSING_REFERENCE', eventId:event.id, message:`Event "${event.id}" references missing event "${ref}".`});
    }
    // Only flag an explicit, parseable ISO date token that disagrees with event date.
    const tokens = event.content.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    const eventDate = new Date(event.time).toISOString().slice(0,10);
    for (const token of tokens) {
      if (!Number.isNaN(Date.parse(token)) && token !== eventDate) findings.push({severity:'warning', code:'DATE_MISMATCH', eventId:event.id, message:`Content date ${token} differs from event date ${eventDate}. Review context before treating this as a discrepancy.`});
    }
  }
  return {valid:true, errors:[], findings};
}
