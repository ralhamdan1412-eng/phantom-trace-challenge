import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import './style.css';
import { auditTrace } from './audit-core.mjs';
import type { AIReview } from './local-ai-review.mjs';

const EventSchema = z.object({ id: z.string().min(1), type: z.string().min(1), time: z.string().min(1), content: z.string(), references: z.array(z.string()).optional() }).strict();
const TraceSchema = z.object({ title: z.string().optional(), task: z.string().optional(), events: z.array(EventSchema).max(10000) }).strict();
type Trace = z.infer<typeof TraceSchema>;
const demo: Trace = { title: 'Synthetic trace review', task: 'Local demonstration only', events: [
  { id: 'EV-001', type: 'tool', time: '2026-10-27T09:00:00Z', content: 'Deployment check failed: permission denied.', references: [] },
  { id: 'EV-002', type: 'claim', time: '2026-10-27T09:01:12Z', content: 'The deployment completed successfully.', references: ['EV-001'] },
  { id: 'EV-003', type: 'claim', time: '2026-10-27T09:03:40Z', content: 'The report was exported.', references: ['EV-404'] },
  { id: 'EV-004', type: 'tool', time: '2026-10-27T09:05:00Z', content: 'Health check passed for service A.', references: [] },
  { id: 'EV-005', type: 'claim', time: '2026-10-27T09:05:15Z', content: 'Service A passed its health check.', references: ['EV-004'] },
] };

function App() {
  const [trace, setTrace] = useState<Trace>(demo);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [raw, setRaw] = useState('');
  const [message, setMessage] = useState('');
  const [aiMessage, setAiMessage] = useState('');
  const [aiReviews, setAiReviews] = useState<AIReview[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const report = useMemo(() => auditTrace(trace), [trace]);
  const events = trace.events.filter((event) => (filter === 'all' || event.type === filter) && `${event.id} ${event.type} ${event.content}`.toLowerCase().includes(query.toLowerCase()));
  const claimCount = trace.events.filter((event) => ['claim', 'assertion', 'final'].includes(event.type.toLowerCase())).length;

  function load(value: string) {
    if (value.length > 5 * 1024 * 1024) { setMessage('Import rejected: maximum file size is 5 MB.'); return; }
    try {
      const parsed = JSON.parse(value);
      const result = TraceSchema.safeParse(parsed);
      if (!result.success) { setMessage('Import rejected: ' + result.error.issues.slice(0, 4).map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join(' | ')); return; }
      const ids = result.data.events.map((event) => event.id);
      if (new Set(ids).size !== ids.length) { setMessage('Import rejected: duplicate event IDs are not allowed.'); return; }
      setTrace(result.data);
      setAiReviews([]);
      setAiMessage('');
      setMessage(`Imported ${result.data.events.length} events locally. Nothing was uploaded.`);
      setRaw('');
    } catch { setMessage('Import rejected: invalid JSON.'); }
  }

  async function reviewWithLocalModel() {
    setAnalyzing(true);
    setAiReviews([]);
    setAiMessage('Loading the open model into this browser. The first run may take a while.');
    try {
      const { analyzeTraceLocally } = await import('./local-ai-review-browser');
      const result = await analyzeTraceLocally(trace);
      setAiReviews(result);
      setAiMessage(result.length ? 'Local model review complete. Treat every result as a hypothesis.' : 'No reviewable claim events were returned.');
    } catch (error) {
      setAiMessage(`Local review failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally { setAnalyzing(false); }
  }

  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
  }

  const reportText = `# PHANTOM TRACE audit report\n\n- Trace: ${trace.title ?? 'Untitled'}\n- Events: ${trace.events.length}\n- Generated locally: ${new Date().toISOString()}\n- Valid structure: ${report.valid}\n\n## Deterministic findings\n\n${report.findings.length ? report.findings.map((finding) => `- **${finding.severity.toUpperCase()} · ${finding.code} · ${finding.eventId}** — ${finding.message}`).join('\n') : 'No findings from the enabled deterministic rules.'}\n\n## Local AI hypotheses\n\n${aiReviews.length ? aiReviews.map((review) => `- **${review.claimId} · ${review.assessment}** — ${review.reason} (evidence: ${review.evidenceIds.join(', ') || 'none'})`).join('\n') : 'No local AI review is included.'}\n\nAI output is untrusted assistive analysis. Citation IDs are checked against trace references; human review is required.\n`;

  return <main className="shell">
    <header><div><p className="eyebrow">BROWSER-LOCAL TRACE REVIEW</p><h1>PHANTOM <span>TRACE</span></h1><p className="subtitle">Trace integrity review · evidence references · local AI hypotheses</p></div><span className="local-pill">● BROWSER-LOCAL</span></header>
    <section className="privacy"><strong>Privacy boundary</strong><p>Trace analysis stays in this browser. Local AI is optional: selecting “Run local AI review” downloads open model files from Hugging Face on first use, then inference runs in the browser. Trace text is not sent to Hugging Face or an AI API. Use synthetic data until the security model is reviewed.</p></section>
    <section className="toolbar"><div><label htmlFor="search">Search events</label><input id="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, type, or content" /></div><div><label htmlFor="filter">Event type</label><select id="filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All types</option>{Array.from(new Set(trace.events.map((event) => event.type))).map((type) => <option key={type}>{type}</option>)}</select></div><button className="secondary" onClick={() => { setTrace(demo); setAiReviews([]); setAiMessage(''); setMessage('Synthetic demo restored.'); }}>Reset demo</button></section>
    <section className="metrics"><article><span>Events</span><strong>{trace.events.length}</strong></article><article><span>Errors</span><strong>{report.findings.filter((finding) => finding.severity === 'error').length}</strong></article><article><span>Warnings</span><strong>{report.findings.filter((finding) => finding.severity === 'warning').length}</strong></article><article><span>References</span><strong>{trace.events.reduce((count, event) => count + (event.references?.length ?? 0), 0)}</strong></article></section>
    <div className="columns"><section className="panel"><div className="panel-head"><div><p className="eyebrow">TRACE TIMELINE</p><h2>{trace.title ?? 'Untitled trace'}</h2></div><span className="count">{events.length} shown</span></div><div className="event-list">{events.map((event) => <article className="event" key={event.id}><div className="timeline-mark" /><div className="event-body"><div className="event-top"><strong>{event.id}</strong><span className="type">{event.type}</span></div><time>{event.time}</time><p>{event.content}</p>{event.references?.length ? <small>References: {event.references.join(', ')}</small> : null}</div></article>)}{!events.length && <p className="empty">No events match the current filters.</p>}</div></section>
      <section className="panel findings"><div className="panel-head"><div><p className="eyebrow">DETERMINISTIC CHECKS</p><h2>Findings</h2></div><span className="count">{report.findings.length} total</span></div>{report.findings.length ? report.findings.map((finding, index) => <article className={`finding ${finding.severity}`} key={`${finding.code}-${finding.eventId}-${index}`}><div className="finding-top"><strong>{finding.code.replaceAll('_', ' ')}</strong><span>{finding.severity}</span></div><small>Event {finding.eventId}</small><p>{finding.message}</p></article>) : <p className="empty">No findings from the enabled rules.</p>}<p className="disclaimer">Structural errors and heuristic warnings are distinct. Findings are not conclusions about intent or wrongdoing.</p></section></div>
    <section className="panel ai-panel"><div className="panel-head"><div><p className="eyebrow">OPTIONAL · OPEN MODEL · IN-BROWSER</p><h2>Claim and evidence review</h2></div><span className="count">{aiReviews.length} hypotheses</span></div><p className="ai-intro">The model compares claim events with their explicitly cited evidence. A deterministic check rejects invented event IDs before results appear.</p><button onClick={reviewWithLocalModel} disabled={analyzing || claimCount === 0}>{analyzing ? 'Reviewing locally…' : 'Run local AI review'}</button>{aiMessage && <p className="status" role="status">{aiMessage}</p>}{aiReviews.map((review) => <article className={`ai-review ${review.assessment}`} key={review.claimId}><div className="finding-top"><strong>{review.claimId}</strong><span>{review.assessment}</span></div><p>{review.reason}</p><small>Evidence IDs: {review.evidenceIds.length ? review.evidenceIds.join(', ') : 'none'}</small></article>)}<p className="disclaimer">AI assessments are hypotheses, can be wrong, and do not replace source verification or human review. Model weights are downloaded from Hugging Face on first use; trace content remains in-browser.</p></section>
    <section className="panel import-panel"><div className="panel-head"><div><p className="eyebrow">LOCAL DATA TOOLS</p><h2>Import and export</h2></div></div><div className="import-grid"><div><label htmlFor="file">Import JSON file (max 5 MB)</label><input id="file" type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) load(await file.text()); event.currentTarget.value = ''; }} /><label htmlFor="paste">Or paste JSON</label><textarea id="paste" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'{ "title": "My trace", "events": [] }'} rows={4} /><button onClick={() => load(raw)}>Validate and import</button></div><div className="export-side"><p>Export the current trace or a readable audit report. Exports are generated locally.</p><button className="secondary" onClick={() => download('phantom-trace.json', JSON.stringify(trace, null, 2), 'application/json')}>Export trace JSON</button><button className="secondary" onClick={() => download('phantom-trace-report.md', reportText, 'text/markdown')}>Export Markdown report</button></div></div>{message && <p className="status" role="status">{message}</p>}</section>
    <footer><span>PHANTOM TRACE · MVP 0.2</span><span>No trace upload · no telemetry · synthetic demo</span></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
