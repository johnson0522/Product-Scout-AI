'use client';

import { useEffect, useState } from 'react';
import type { ResearchQualitySnapshot } from '@product-scout/evidence/research-quality-model';
import { list, number, object, records, requestJson, text, qualitySnapshots, safeSource } from '../lib/product-client';
import { QualityDiagnostics } from './QualityDiagnostics';

interface Results {
  readonly reports: readonly Record<string, unknown>[];
  readonly opportunities: readonly Record<string, unknown>[];
  readonly plans: readonly Record<string, unknown>[];
  readonly evidence: readonly Record<string, unknown>[];
  readonly claims: readonly Record<string, unknown>[];
  readonly findings: readonly Record<string, unknown>[];
  readonly quality: readonly ResearchQualitySnapshot[];
}

export function ResearchResults({ runId, status }: { readonly runId: string; readonly status: string }) {
  const [data, setData] = useState<Results>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([
      requestJson(`/api/research/${encodeURIComponent(runId)}/report`),
      requestJson(`/api/research/${encodeURIComponent(runId)}/evidence`),
    ]).then(([report, trace]) => {
      if (active) { setData({ reports: records(report.reports), opportunities: records(report.opportunities), plans: records(report.validationPlans), evidence: records(trace.evidence), claims: records(trace.claims), findings: records(trace.findings), quality: qualitySnapshots(trace.qualityAssessments) }); setError(''); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load results'); });
    return () => { active = false; };
  }, [runId, status]);
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!data) return <p>Loading research results…</p>;
  return <>
    <QualityDiagnostics findings={data.findings} claims={data.claims} snapshots={data.quality} />
    <section className="panel"><h2>Research report</h2>
      {data.reports.length === 0 && <p>{status === 'completed' ? 'No report is available.' : 'The report appears after research and validation-plan generation finish.'}</p>}
      {data.reports.map((report) => <article key={text(report.id)}><h3>{text(report.title)}</h3><p className="prose">{text(report.executiveSummary)}</p>
        {records(report.sections).map((section) => <section key={text(section.id)}><h3>{text(section.title)}</h3><p className="prose">{text(section.content)}</p><References ids={list(section.findingIds)} kind="finding" /><References ids={list(section.opportunityIds)} kind="opportunity" /></section>)}
        <h3>Limitations</h3><ul>{list(report.limitations).map((item, i) => <li key={i}>{text(item)}</li>)}</ul>
      </article>)}
    </section>
    <section className="panel"><h2>Opportunities</h2>{data.opportunities.length === 0 && <p>No evidence-backed opportunity has been produced. This does not imply there is no market opportunity.</p>}
      {data.opportunities.map((opportunity) => {
        const score = object(opportunity.score);
        return <article id={`opportunity-${text(opportunity.id)}`} key={text(opportunity.id)}><h3>{text(opportunity.title)} <span className="score">{number(score.total)}/100</span></h3>
          <dl>{[['targetCustomer', 'Customer'], ['problem', 'Problem'], ['solution', 'Solution'], ['whyNow', 'Why now'], ['monetization', 'Monetization'], ['mvp', 'MVP']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd className="prose">{text(opportunity[key!])}</dd></div>)}</dl>
          <p>Confidence: {number(opportunity.confidence)}/100</p>
          <table><caption>Reproducible opportunity score</caption><thead><tr><th>Factor</th><th>Value</th><th>Weight</th><th>Contribution</th><th>Explanation</th></tr></thead><tbody>{Object.entries(object(score.breakdown)).map(([key, value]) => { const factor = object(value); return <tr key={key}><th>{key}</th><td>{number(factor.value)}</td><td>{number(factor.weight) * 100}%</td><td>{number(factor.contribution)}</td><td>{text(object(opportunity.scoreReasoning)[key])}</td></tr>; })}</tbody></table>
          <References ids={list(opportunity.evidenceIds)} kind="evidence" />
        </article>;
      })}
    </section>
    <section className="panel"><h2>7-day validation plan</h2>{data.plans.length === 0 && <p>No validation plan is available yet.</p>}{data.plans.map((plan) => <ol key={text(plan.id)} className="validation-days">{records(plan.days).map((day) => <li key={number(day.day)}><h3>Day {number(day.day)} · {text(day.objective)}</h3><ul>{list(day.activities).map((item, i) => <li key={i}>{text(item)}</li>)}</ul><h4>Success criteria</h4><ul>{list(day.successCriteria).map((item, i) => <li key={i}>{text(item)}</li>)}</ul></li>)}</ol>)}</section>
    <section className="panel"><h2>Findings and claims</h2>{data.findings.map((finding) => <article id={`finding-${text(finding.id)}`} key={text(finding.id)}><h3>{text(finding.title)}</h3><p>{text(finding.description)}</p><References ids={list(finding.claimIds)} kind="claim" /></article>)}{data.claims.map((claim) => <article id={`claim-${text(claim.id)}`} key={text(claim.id)}><h3>Claim</h3><p>{text(claim.text)}</p><References ids={records(claim.evidenceRefs).map((ref) => ref.evidenceId)} kind="evidence" /></article>)}</section>
    <section className="panel"><h2>Sources and evidence</h2><p>Source content is untrusted. Evidence excerpts preserve observations; they do not prove a claim on their own.</p>{data.evidence.length === 0 && <p>No evidence has been collected.</p>}{data.evidence.map((evidence) => {
      const source = object(evidence.source);
      const url = safeSource(text(source.url));
      return <article id={`evidence-${text(evidence.id)}`} key={text(evidence.id)}><h3>{text(evidence.title)}</h3><blockquote>{text(evidence.excerpt)}</blockquote><p>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{url}</a> : 'Source link unavailable'}</p><small>Retrieved {text(evidence.retrievedAt)}</small></article>;
    })}</section>
  </>;
}

function References({ ids, kind }: { readonly ids: readonly unknown[]; readonly kind: string }) {
  if (ids.length === 0) return null;
  return <p className="references">{kind}: {ids.map((id, index) => <a key={text(id)} href={`#${kind}-${text(id)}`}>{index + 1}</a>)}</p>;
}
