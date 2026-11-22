import { describe, expect, it } from 'vitest';
import { qualitySnapshotFixture } from '../../../tests/fixtures/research-quality';
import { createResearchQualitySnapshot } from '../src';

describe('quality snapshot boundary', () => {
  it('preserves classified inputs, complete rules and millisecond timestamp without sharing objects', () => {
    const input = qualitySnapshotFixture();
    const snapshot = createResearchQualitySnapshot(input);
    expect(snapshot).toEqual(input);
    expect(snapshot.assessment).not.toBe(input.assessment);
    expect(snapshot.assessedAt).not.toBe(input.assessedAt);
  });
  it.each([
    { rulesVersion: 'unknown-version' }, { assessedAt: new Date('invalid') }, { inputs: [] },
    { inputs: [...qualitySnapshotFixture().inputs, ...qualitySnapshotFixture().inputs] },
    { findingId: 'different-finding' },
    { assessment: { ...qualitySnapshotFixture().assessment, status: 'sufficient' } },
    { assessment: { ...qualitySnapshotFixture().assessment, requiresHumanReview: false } },
    { assessment: { ...qualitySnapshotFixture().assessment, claims: [] } },
    { assessment: { ...qualitySnapshotFixture().assessment, issues: [] } },
    { inputs: [{ ...qualitySnapshotFixture().inputs[0], relation: 'invented' }] },
    { inputs: [{ ...qualitySnapshotFixture().inputs[0], sourceKind: 'invented' }] },
    { inputs: [{ ...qualitySnapshotFixture().inputs[0], evidenceId: 'unreferenced-evidence' }] },
  ])('rejects invalid or inconsistent persisted data: %j', (change) => {
    expect(() => createResearchQualitySnapshot({ ...qualitySnapshotFixture(), ...change })).toThrow('Invalid research quality snapshot');
  });
  it('selects only business fields and does not retain unknown runtime fields', () => {
    const snapshot = createResearchQualitySnapshot({ ...qualitySnapshotFixture(), trajectory: 'private',
      assessment: { ...qualitySnapshotFixture().assessment, reasoningTokens: 'private' } });
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });
});
