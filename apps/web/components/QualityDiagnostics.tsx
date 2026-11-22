import type { ResearchQualitySnapshot } from '@product-scout/evidence/research-quality-model';
import { safeSource, text } from '../lib/product-client';

const STATUS_LABELS = {
  sufficient: 'Sufficient', needs_review: 'Needs review', insufficient: 'Insufficient', conflicted: 'Conflicted',
} as const;

export function QualityDiagnostics({ findings, claims, snapshots }: {
  readonly findings: readonly Record<string, unknown>[];
  readonly claims: readonly Record<string, unknown>[];
  readonly snapshots: readonly ResearchQualitySnapshot[];
}) {
  return <section className="panel"><h2>Research quality</h2>
    <p>Automatic reports require a sufficient assessment with no human review required. Different source URLs do not establish independent corroboration.</p>
    {findings.length === 0 && <p>No Findings are available to assess yet.</p>}
    {findings.map((finding) => {
      const id = text(finding.id);
      const assessments = snapshots.filter((snapshot) => snapshot.findingId === id);
      return <article key={id}><h3><a href={`#finding-${id}`}>{text(finding.title)}</a></h3>
        {assessments.length === 0 && <p>No saved quality assessment exists for this Finding. Earlier runs did not record assessments; a missing assessment does not mean approval.</p>}
        {assessments.map((snapshot) => <div key={`${snapshot.workflowInvocationKey}:${snapshot.rulesVersion}`}>
          <p><strong>{STATUS_LABELS[snapshot.assessment.status]}</strong> · {snapshot.assessment.requiresHumanReview ? 'Human review required' : 'No human review required'}</p>
          <p><small>Rules {snapshot.rulesVersion} · Assessed {snapshot.assessedAt.toISOString()}</small></p>
          {snapshot.assessment.issues.length === 0 && <p>No quality rules triggered.</p>}
          {snapshot.assessment.claims.map((assessment) => {
            const claim = claims.find((item) => item.id === assessment.claimId);
            return <details key={assessment.claimId}><summary>{claim ? text(claim.text) : assessment.claimId} — {STATUS_LABELS[assessment.status]}</summary>
              <p><a href={`#claim-${assessment.claimId}`}>View Claim</a> · Supporting Evidence: {assessment.supportingEvidenceIds.length} · Distinct supporting URLs: {assessment.distinctSupportingSourceUrls.length}</p>
              <ul>{assessment.issues.map((issue) => <li key={issue.code}>
                <strong>{issue.ruleId} · {issue.code}</strong>: {issue.reason}
                <p>Blocking issue: {issue.blocking ? 'Yes' : 'No'} · Human review: {issue.requiresHumanReview ? 'Required' : 'Not required'}</p>
                <p>Evidence: {issue.evidenceIds.map((evidenceId, index) => <a key={evidenceId} href={`#evidence-${evidenceId}`}>{index + 1} </a>)}</p>
                <ul>{issue.sourceUrls.map((source) => <li key={source}>{safeSource(source)
                  ? <a href={safeSource(source)!} target="_blank" rel="noopener noreferrer">{source}</a> : 'Source link unavailable'}</li>)}</ul>
              </li>)}</ul>
              <details><summary>All rule outcomes</summary><ul>{assessment.ruleResults.map((rule) => <li key={rule.ruleId}>{rule.ruleId}: {rule.outcome} — {rule.reason}</li>)}</ul></details>
              <details><summary>Evidence classifications used</summary><ul>{snapshot.inputs.filter((input) => input.claimId === assessment.claimId).map((input) => <li key={input.evidenceId}>
                <a href={`#evidence-${input.evidenceId}`}>Evidence {input.evidenceId}</a>: {input.relation} · {input.semanticKind} · {input.sourceKind}
              </li>)}</ul></details>
            </details>;
          })}
        </div>)}
      </article>;
    })}
  </section>;
}
