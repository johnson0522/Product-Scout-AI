import { describe, expect, it, vi } from 'vitest';
import { createResearchReport, type ResearchReport } from '@product-scout/domain';

import {
  DrizzleResearchReportRepository,
  ResearchReportPersistenceConflictError,
  researchReports,
  type Database,
} from '../src';

type ReportRow = typeof researchReports.$inferSelect;

describe('DrizzleResearchReportRepository', () => {
  it('persists and rehydrates the complete report', async () => {
    const value = report();
    const database = databaseMock(undefined, undefined, value.createdAt);
    const repository = new DrizzleResearchReportRepository(database.db);
    await expect(repository.ensure(value)).resolves.toEqual(value);
    await expect(repository.findById(value.id)).resolves.toEqual(value);
  });

  it('reuses an identical replay and rejects changed content', async () => {
    const value = report();
    const database = databaseMock(value);
    const repository = new DrizzleResearchReportRepository(database.db);
    await expect(repository.ensure({
      ...value,
      createdAt: new Date('2026-11-14T02:00:00.000Z'),
    })).resolves.toEqual(value);
    expect(database.insert).not.toHaveBeenCalled();
    await expect(repository.ensure({ ...value, title: 'Changed report' }))
      .rejects.toBeInstanceOf(ResearchReportPersistenceConflictError);
  });

  it('rereads the concurrent winner after an insert conflict', async () => {
    const value = report();
    const database = databaseMock(undefined, value);
    const repository = new DrizzleResearchReportRepository(database.db);
    await expect(repository.ensure(value)).resolves.toEqual(value);
  });

  it('rejects a second report identity for the same ResearchRun', async () => {
    const value = report();
    const repository = new DrizzleResearchReportRepository(databaseMock(value).db);
    await expect(repository.ensure({
      ...value,
      id: '30000000-0000-5000-8000-000000000003',
    })).rejects.toBeInstanceOf(ResearchReportPersistenceConflictError);
  });
});

function databaseMock(
  initial?: ResearchReport,
  concurrent?: ResearchReport,
  insertedCreatedAt: Date | undefined = initial?.createdAt ?? concurrent?.createdAt,
) {
  let row = initial === undefined ? undefined : toRow(initial);
  let reads = 0;
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          reads += 1;
          if (concurrent !== undefined && reads >= 2) row = toRow(concurrent);
          return row === undefined ? [] : [row];
        },
        then: (resolve: (value: readonly ReportRow[]) => unknown) =>
          resolve(row === undefined ? [] : [row]),
      }),
    }),
  }));
  const returning = vi.fn(async () => {
    if (concurrent !== undefined) throw new Error('duplicate key');
    return row === undefined ? [] : [row];
  });
  const values = vi.fn((value: Omit<ReportRow, 'createdAt' | 'updatedAt'>) => {
    if (insertedCreatedAt === undefined) throw new Error('Missing inserted createdAt fixture');
    row = { ...value, createdAt: insertedCreatedAt, updatedAt: insertedCreatedAt };
    return { returning };
  });
  const insert = vi.fn(() => ({ values }));
  return {
    db: { select, insert } as unknown as Database,
    insert,
  };
}

function toRow(value: ResearchReport): ReportRow {
  return {
    id: value.id,
    researchRunId: value.researchRunId,
    title: value.title,
    executiveSummary: value.executiveSummary,
    sections: value.sections.map((section) => ({
      ...section,
      findingIds: [...section.findingIds],
      opportunityIds: [...section.opportunityIds],
    })),
    limitations: [...value.limitations],
    createdAt: value.createdAt,
    updatedAt: value.createdAt,
  };
}

function report(): ResearchReport {
  return createResearchReport({
    id: '10000000-0000-5000-8000-000000000001',
    researchRunId: '20000000-0000-4000-8000-000000000002',
    title: 'Research report',
    executiveSummary: 'Evidence supports a focused opportunity.',
    sections: [{
      id: 'findings',
      title: 'Findings',
      content: 'Teams report recurring work.',
      findingIds: ['finding-1'],
      opportunityIds: [],
    }],
    limitations: ['No pricing interview was conducted.'],
    createdAt: new Date('2026-11-14T01:00:00.000Z'),
  });
}
