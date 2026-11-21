'use client';

import { useEffect, useState } from 'react';
import { ResearchResults } from './ResearchResults';
import { object, requestJson, runSummary, STEP_LABELS, TERMINAL_STATUSES, type RunSummary } from '../lib/product-client';

export function ResearchWorkspace({ runId }: { readonly runId: string }) {
  const [run, setRun] = useState<RunSummary>();
  const [events, setEvents] = useState<readonly string[]>([]);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let active = true;
    let finished = false;
    const stream = new EventSource(`/api/research/${encodeURIComponent(runId)}/events`);
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || !active || finished) return;
      refreshing = true;
      try {
        const data = await requestJson(`/api/research/${encodeURIComponent(runId)}`);
        const value = runSummary(data.researchRun);
        if (!active) return;
        setRun(value); setError('');
        if (TERMINAL_STATUSES.includes(value.status)) { finished = true; stream.close(); setConnection('Finished'); }
      } catch (reason: unknown) { if (active) setError(message(reason)); }
      finally { refreshing = false; }
    };
    stream.onopen = () => { if (active) setConnection('Live'); };
    const seen = new Set<string>();
    const receive = (event: MessageEvent<string>) => {
      if (!active) return;
      try {
        const data = object(JSON.parse(event.data));
        if (typeof data.eventId !== 'string' || seen.has(data.eventId)) return;
        seen.add(data.eventId);
        const label = typeof data.stepType === 'string' ? STEP_LABELS[data.stepType] ?? data.stepType : typeof data.toolName === 'string' ? data.toolName : '';
        setEvents((items) => [...items.slice(-99), `${event.type.replaceAll('research.', '').replaceAll('.', ' ')} ${label}`.trim()]);
        void refresh();
      } catch { setConnection('Refreshing progress'); }
    };
    for (const type of ['research.started', 'research.step.started', 'research.step.completed', 'research.tool.started', 'research.tool.completed', 'research.evidence.created', 'research.opportunity.created', 'research.completed', 'research.failed', 'research.cancelled']) stream.addEventListener(type, receive);
    stream.onerror = () => { if (active && !finished) { setConnection('Reconnecting'); void refresh(); } };
    void refresh();
    // Recover status if a terminal event could not be published or the server restarted.
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(timer); stream?.close(); };
  }, [runId]);

  async function cancel() {
    setCancelling(true); setError('');
    try {
      await requestJson(`/api/research/${encodeURIComponent(runId)}/cancel`, {});
      const data = await requestJson(`/api/research/${encodeURIComponent(runId)}`);
      setRun(runSummary(data.researchRun));
    } catch (reason: unknown) { setError(message(reason)); } finally { setCancelling(false); }
  }

  return <main>
    <p className="eyebrow">Research workspace</p><h1>{run?.goal ?? 'Loading research…'}</h1>
    {error && <p role="alert" className="error">{error}</p>}
    {run && <>
      <div className="toolbar"><span className={`status ${run.status}`}>{run.status}</span><span role="status">{connection}</span>
        {!TERMINAL_STATUSES.includes(run.status) && <button className="secondary" disabled={cancelling} onClick={() => { void cancel(); }}>{cancelling ? 'Cancelling…' : 'Cancel research'}</button>}
      </div>
      {run.errorMessage && <p role="alert" className="error">{run.errorMessage}</p>}
      <section className="panel"><h2>Research progress</h2><ol className="steps">{Object.entries(STEP_LABELS).map(([type, label]) => {
        const step = run.steps.find((item) => item.type === type);
        return <li key={type}><span>{label}</span><span className={`status ${step?.status ?? 'pending'}`}>{step?.status ?? 'pending'}</span></li>;
      })}</ol><details><summary>Recent activity ({events.length})</summary><ol aria-live="polite">{events.map((event, index) => <li key={index}>{event}</li>)}</ol></details></section>
      <ResearchResults runId={runId} status={run.status} />
    </>}
  </main>;
}
function message(reason: unknown): string { return reason instanceof Error ? reason.message : 'Request failed'; }
