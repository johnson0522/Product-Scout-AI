import { describe, expect, it } from 'vitest';

import { createClaim, InvalidClaimError } from '../src';

const validInput = {
  id: 'claim-1',
  researchRunId: 'run-1',
  text: 'Teams repeatedly reconcile the same records by hand.',
  evidenceRefs: [
    { evidenceId: 'evidence-1' },
    { evidenceId: 'evidence-2' },
  ],
  createdAt: new Date('2026-10-19T01:02:03.456Z'),
};

describe('Claim domain model', () => {
  it('creates a claim that references evidence by id only', () => {
    const claim = createClaim(validInput);

    expect(claim).toEqual(validInput);
    expect(claim.createdAt).not.toBe(validInput.createdAt);
    expect(Object.keys(claim.evidenceRefs[0] ?? {})).toEqual(['evidenceId']);
  });

  it.each([
    ['id', ''],
    ['researchRunId', '  '],
    ['text', '\t'],
  ] as const)('rejects an empty %s', (field, value) => {
    expect(() => createClaim({ ...validInput, [field]: value }))
      .toThrow(InvalidClaimError);
  });

  it('requires at least one EvidenceReference', () => {
    expect(() => createClaim({ ...validInput, evidenceRefs: [] }))
      .toThrow('evidenceRefs must contain at least one EvidenceReference');
  });

  it('rejects invalid and duplicate EvidenceIds after normalization', () => {
    expect(() => createClaim({ ...validInput, evidenceRefs: [{ evidenceId: '' }] }))
      .toThrow(InvalidClaimError);
    expect(() => createClaim({
      ...validInput,
      evidenceRefs: [{ evidenceId: 'evidence-1' }, { evidenceId: ' evidence-1 ' }],
    })).toThrow('evidenceRefs must not contain duplicate EvidenceIds');
  });

  it('rejects invalid timestamps', () => {
    expect(() => createClaim({ ...validInput, createdAt: new Date('invalid') }))
      .toThrow('createdAt must be a valid Date');
  });
});
