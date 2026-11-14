import { describe, expect, it } from 'vitest';

import {
  createEvidenceAcquisition,
  InvalidEvidenceAcquisitionError,
  validateEvidenceAcquisitionScope,
} from '../src';

const scope = {
  researchRunId: 'run-1',
  workflowInvocationKey: 'invocation-1',
  stepId: 'market_understanding' as const,
  sourceFingerprint: `sha256:${'a'.repeat(64)}`,
};

describe('EvidenceAcquisition', () => {
  it('validates and copies a successful acquisition record', () => {
    const capturedAt = new Date('2026-11-14T00:00:00.123Z');
    const acquisition = createEvidenceAcquisition({
      id: 'acquisition-1',
      evidenceId: 'evidence-1',
      ...scope,
      capturedAt,
    });

    capturedAt.setUTCFullYear(2030);
    expect(acquisition).toEqual({
      id: 'acquisition-1',
      evidenceId: 'evidence-1',
      ...scope,
      capturedAt: new Date('2026-11-14T00:00:00.123Z'),
    });
  });

  it('rejects empty scope fields and malformed fingerprints', () => {
    expect(() => validateEvidenceAcquisitionScope({
      ...scope,
      workflowInvocationKey: ' ',
    })).toThrow(InvalidEvidenceAcquisitionError);
    expect(() => validateEvidenceAcquisitionScope({
      ...scope,
      sourceFingerprint: 'https://example.test',
    })).toThrow('sourceFingerprint must use the sha256');
  });
});
