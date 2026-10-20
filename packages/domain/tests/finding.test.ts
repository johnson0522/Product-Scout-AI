import { describe, expect, it } from 'vitest';

import { createFinding, InvalidFindingError } from '../src';

const validInput = {
  id: 'finding-1',
  researchRunId: 'run-1',
  type: 'insight' as const,
  title: 'Manual reconciliation is a recurring burden',
  description: 'Multiple claims describe repeated manual reconciliation work.',
  claimIds: ['claim-1', 'claim-2'],
  createdAt: new Date('2026-10-19T01:02:03.456Z'),
};

describe('Research Finding domain model', () => {
  it('creates a traceable finding and defensively copies its timestamp', () => {
    const finding = createFinding(validInput);

    expect(finding).toEqual(validInput);
    expect(finding.createdAt).not.toBe(validInput.createdAt);
  });

  it.each([
    ['id', ''],
    ['researchRunId', '  '],
    ['title', ''],
    ['description', '\t'],
  ] as const)('rejects an empty %s', (field, value) => {
    expect(() => createFinding({ ...validInput, [field]: value }))
      .toThrow(InvalidFindingError);
  });

  it('requires at least one unique ClaimId', () => {
    expect(() => createFinding({ ...validInput, claimIds: [] }))
      .toThrow('claimIds must contain at least one ClaimId');
    expect(() => createFinding({ ...validInput, claimIds: ['claim-1', ' claim-1 '] }))
      .toThrow('claimIds must not contain duplicate ClaimIds');
    expect(() => createFinding({ ...validInput, claimIds: [''] }))
      .toThrow(InvalidFindingError);
  });

  it('rejects invalid timestamps', () => {
    expect(() => createFinding({ ...validInput, createdAt: new Date('invalid') }))
      .toThrow('createdAt must be a valid Date');
  });
});
