import { and, asc, eq, sql } from 'drizzle-orm';
import {
  createResearchQualitySnapshot,
  ResearchQualitySnapshotConflictError,
  type ResearchQualitySnapshot,
  type ResearchQualitySnapshotRepository,
} from '@product-scout/evidence';
import type { Database } from './index';
import { researchFindings, researchQualitySnapshots } from './schema';

type SnapshotRow = typeof researchQualitySnapshots.$inferSelect;

export class DrizzleResearchQualitySnapshotRepository implements ResearchQualitySnapshotRepository {
  public constructor(private readonly db: Database) {}

  public async ensure(input: ResearchQualitySnapshot): Promise<ResearchQualitySnapshot> {
    const snapshot = createResearchQualitySnapshot(input);
    const parent = await this.db.select({ id: researchFindings.id }).from(researchFindings)
      .where(and(eq(researchFindings.id, snapshot.findingId), eq(researchFindings.researchRunId, snapshot.researchRunId))).limit(1);
    if (parent.length === 0) throw new Error('Quality assessment Finding does not belong to ResearchRun');
    const inserted = await this.db.insert(researchQualitySnapshots).values({
      findingId: snapshot.findingId, workflowInvocationKey: snapshot.workflowInvocationKey,
      rulesVersion: snapshot.rulesVersion, assessedAt: sql`${snapshot.assessedAt.toISOString()}`,
      inputs: snapshot.inputs, assessment: snapshot.assessment,
    }).onConflictDoNothing().returning();
    const row = inserted[0];
    if (row !== undefined) return hydrate(row, snapshot.researchRunId);
    const rows = await this.db.select().from(researchQualitySnapshots).where(and(
      eq(researchQualitySnapshots.findingId, snapshot.findingId),
      eq(researchQualitySnapshots.workflowInvocationKey, snapshot.workflowInvocationKey),
      eq(researchQualitySnapshots.rulesVersion, snapshot.rulesVersion),
    )).limit(1);
    const existing = rows[0];
    if (existing === undefined) throw new Error('Quality snapshot replay could not be read');
    const value = hydrate(existing, snapshot.researchRunId);
    if (JSON.stringify(value.inputs) !== JSON.stringify(snapshot.inputs)
      || JSON.stringify(value.assessment) !== JSON.stringify(snapshot.assessment)) {
      throw new ResearchQualitySnapshotConflictError();
    }
    return value;
  }

  public async listByResearchRunId(researchRunId: string): Promise<readonly ResearchQualitySnapshot[]> {
    const rows = await this.db.select({ snapshot: researchQualitySnapshots }).from(researchQualitySnapshots)
      .innerJoin(researchFindings, eq(researchFindings.id, researchQualitySnapshots.findingId))
      .where(eq(researchFindings.researchRunId, researchRunId))
      .orderBy(asc(researchQualitySnapshots.assessedAt), asc(researchQualitySnapshots.findingId));
    return rows.map(({ snapshot }) => hydrate(snapshot, researchRunId));
  }
}

function hydrate(row: SnapshotRow, researchRunId: string): ResearchQualitySnapshot {
  return createResearchQualitySnapshot({ ...row, researchRunId });
}
