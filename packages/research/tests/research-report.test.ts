import { describe, expect, it } from 'vitest';
import type { Finding, Opportunity, ResearchReport } from '@product-scout/domain';

import {
  createResearchReportAggregateId,
  InvalidResearchReportPlanError,
  parseResearchReportPlan,
  ResearchReportService,
  validateResearchReportPlan,
  type ResearchReportPlan,
  type ResearchReportPlanInput,
} from '../src';

const finding: Finding = {
  id: 'finding-1',
  researchRunId: 'run-1',
  type: 'insight',
  title: 'Recurring work',
  description: 'Teams report recurring reconciliation work.',
  claimIds: ['claim-1'],
  createdAt: new Date('2026-11-14T00:00:00.000Z'),
};
const opportunity = {
  id: '10000000-0000-5000-8000-000000000001',
  researchRunId: 'run-1',
} as Opportunity;
const input: ResearchReportPlanInput = {
  researchRunId: 'run-1',
  goal: 'Research recurring work',
  invocationKey: 'invocation-1',
  findings: [finding],
  opportunities: [opportunity],
};
const plan: ResearchReportPlan = {
  title: 'Recurring work report',
  executiveSummary: 'Evidence supports a focused workflow opportunity.',
  sections: [{
    id: 'opportunity',
    title: 'Opportunity',
    content: 'A focused assistant could reduce recurring work.',
    findingIds: [finding.id],
    opportunityIds: [opportunity.id],
  }],
  limitations: ['No direct pricing interview was conducted.'],
};

describe('ResearchReport plan', () => {
  it('strictly parses and validates only available references', () => {
    expect(parseResearchReportPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(validateResearchReportPlan(plan, input)).toEqual(plan);
    expect(() => parseResearchReportPlan({ ...plan, extra: true }))
      .toThrow('unknown field');
    expect(() => validateResearchReportPlan({
      ...plan,
      sections: [{ ...plan.sections[0]!, findingIds: ['missing'] }],
    }, input)).toThrow('unavailable Finding');
    expect(() => validateResearchReportPlan({
      ...plan,
      sections: [{ ...plan.sections[0]!, opportunityIds: ['missing'] }],
    }, input)).toThrow('unavailable Opportunity');
  });

  it('rejects empty, untraceable, and duplicate sections', () => {
    expect(() => validateResearchReportPlan({ ...plan, sections: [] }, input))
      .toThrow(InvalidResearchReportPlanError);
    expect(() => validateResearchReportPlan({
      ...plan,
      sections: [{ ...plan.sections[0]!, findingIds: [], opportunityIds: [] }],
    }, input)).toThrow('must reference');
    expect(() => validateResearchReportPlan({
      ...plan,
      sections: [plan.sections[0]!, plan.sections[0]!],
    }, input)).toThrow('Duplicate section');
  });

  it('persists a deterministic report through the injected store', async () => {
    const reports = new Map<string, ResearchReport>();
    const service = new ResearchReportService(
      { createPlan: async () => plan },
      {
        async getById(id) { return reports.get(id) ?? null; },
        async ensure(report) {
          reports.set(report.id, report);
          return report;
        },
      },
      () => new Date('2026-11-14T01:00:00.000Z'),
    );
    const report = await service.generate(input);
    expect(report.id).toBe(createResearchReportAggregateId('run-1', 'invocation-1'));
    expect(reports.get(report.id)).toEqual(report);
  });

  it('creates stable UUIDs separated by run and invocation', () => {
    const id = createResearchReportAggregateId('run-1', 'invocation-1');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createResearchReportAggregateId('run-1', 'invocation-1')).toBe(id);
    expect(createResearchReportAggregateId('run-1', 'invocation-2')).not.toBe(id);
  });
});
