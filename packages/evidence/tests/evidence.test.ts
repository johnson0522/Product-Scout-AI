import { describe, expect, it } from 'vitest';

import {
  createClaimEvidenceLinks,
  createEvidence,
  createEvidenceReference,
  createEvidenceSource,
  InvalidEvidenceError,
  type Evidence,
} from '../src';

const validInput = {
  id: 'evidence-1',
  source: {
    url: 'https://example.test/research',
    title: 'Research source',
    domain: 'example.test',
  },
  title: 'Observed customer pain',
  excerpt: 'Customers report losing time to manual scheduling.',
  retrievedAt: new Date('2026-01-01T00:00:00.000Z'),
} as const;

describe('Evidence domain model', () => {
  it('creates valid immutable-by-contract evidence with source traceability', () => {
    const evidence = createEvidence(validInput);

    expect(evidence).toMatchObject({
      id: 'evidence-1',
      source: { url: 'https://example.test/research' },
      title: 'Observed customer pain',
      excerpt: 'Customers report losing time to manual scheduling.',
    });
    expect(evidence.retrievedAt).toEqual(validInput.retrievedAt);

    const typedEvidence: Evidence = evidence;
    expect(typedEvidence.id).toBe('evidence-1');
  });

  it.each([
    ['', 'id'],
    ['', 'source.url'],
    ['hello', 'source.url'],
    ['', 'title'],
    ['', 'excerpt'],
  ] as const)('rejects invalid %s for %s', (value, field) => {
    const input = field === 'id'
      ? { ...validInput, id: value }
      : field === 'source.url'
        ? { ...validInput, source: { ...validInput.source, url: value } }
        : field === 'title'
          ? { ...validInput, title: value }
          : { ...validInput, excerpt: value };

    expect(() => createEvidence(input)).toThrow(InvalidEvidenceError);
  });

  it('requires http and https source URLs', () => {
    expect(() => createEvidenceSource({ url: 'ftp://example.test/file' }))
      .toThrow(InvalidEvidenceError);
    expect(() => createEvidenceSource({ url: 'https://example.test/file' }))
      .not.toThrow();
  });

  it('preserves retrievedAt and rejects invalid dates', () => {
    const retrievedAt = new Date('2026-03-04T05:06:07.000Z');
    const evidence = createEvidence({ ...validInput, retrievedAt });

    expect(evidence.retrievedAt).toEqual(retrievedAt);
    expect(() => createEvidence({
      ...validInput,
      retrievedAt: new Date('invalid'),
    })).toThrow(InvalidEvidenceError);
  });

  it('copies dates so the input date cannot mutate the evidence timestamp', () => {
    const retrievedAt = new Date('2026-01-01T00:00:00.000Z');
    const evidence = createEvidence({ ...validInput, retrievedAt });
    retrievedAt.setUTCFullYear(2030);

    expect(evidence.retrievedAt.getUTCFullYear()).toBe(2026);
  });
});

describe('EvidenceReference', () => {
  it('contains only a non-empty EvidenceId', () => {
    const reference = createEvidenceReference('evidence-1');

    expect(reference).toEqual({ evidenceId: 'evidence-1' });
    expect(Object.keys(reference)).toEqual(['evidenceId']);
    expect(() => createEvidenceReference('')).toThrow(InvalidEvidenceError);
  });

  it('supports one or multiple references without embedding snapshots', () => {
    const one = [{ evidenceId: 'evidence-1' }] as const;
    const multiple = [
      { evidenceId: 'evidence-1' },
      { evidenceId: 'evidence-2' },
    ] as const;

    expect(createClaimEvidenceLinks(one).evidenceRefs).toEqual(one);
    expect(createClaimEvidenceLinks(multiple).evidenceRefs).toEqual(multiple);
  });
});
