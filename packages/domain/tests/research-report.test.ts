import { describe, expect, it } from 'vitest';

import { createResearchReport, InvalidResearchReportError } from '../src';

const input = {
  id: '10000000-0000-5000-8000-000000000001',
  researchRunId: 'run-1',
  title: 'Market report',
  executiveSummary: 'A recurring operational pain supports one focused opportunity.',
  sections: [{
    id: 'market-findings',
    title: 'Market findings',
    content: 'Teams repeatedly report reconciliation work.',
    findingIds: ['finding-1'],
    opportunityIds: [],
  }],
  limitations: ['No direct pricing interview was conducted.'],
  createdAt: new Date('2026-11-14T00:00:00.000Z'),
} as const;

describe('createResearchReport', () => {
  it('creates an immutable-shape report and copies its timestamp', () => {
    const report = createResearchReport(input);
    expect(report).toEqual(input);
    expect(report.createdAt).not.toBe(input.createdAt);
  });

  it('requires sections with explicit traceability and unique references', () => {
    expect(() => createResearchReport({ ...input, sections: [] }))
      .toThrow('at least one section');
    expect(() => createResearchReport({
      ...input,
      sections: [{ ...input.sections[0], findingIds: [], opportunityIds: [] }],
    })).toThrow('must reference at least one');
    expect(() => createResearchReport({
      ...input,
      sections: [{ ...input.sections[0], findingIds: ['finding-1', 'finding-1'] }],
    })).toThrow(InvalidResearchReportError);
  });

  it('rejects empty content and invalid timestamps', () => {
    expect(() => createResearchReport({ ...input, executiveSummary: ' ' }))
      .toThrow('executiveSummary');
    expect(() => createResearchReport({ ...input, createdAt: new Date('invalid') }))
      .toThrow('valid Date');
  });
});
