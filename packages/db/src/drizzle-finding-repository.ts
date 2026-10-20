import { asc, eq, sql } from 'drizzle-orm';
import {
  createFinding,
  type Finding,
  type FindingId,
  type ResearchRunId,
} from '@product-scout/domain';
import type { ResearchFindingRepository } from '@product-scout/evidence';

import type { Database } from './index';
import { researchFindingClaims, researchFindings } from './schema';

type FindingRow = typeof researchFindings.$inferSelect;

export class DrizzleResearchFindingRepository implements ResearchFindingRepository {
  public constructor(private readonly db: Database) {}

  public async create(finding: Finding): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.insert(researchFindings).values({
        id: finding.id,
        researchRunId: finding.researchRunId,
        type: finding.type,
        title: finding.title,
        description: finding.description,
        createdAt: sql`${finding.createdAt.toISOString()}`,
      });
      await transaction.insert(researchFindingClaims).values(
        finding.claimIds.map((claimId, position) => ({
          findingId: finding.id,
          claimId,
          position,
        })),
      );
    });
  }

  public async getById(id: FindingId): Promise<Finding | null> {
    const rows = await this.db.select().from(researchFindings)
      .where(eq(researchFindings.id, id))
      .limit(1);
    const row = rows[0];
    return row ? this.hydrate(row) : null;
  }

  public async listByResearchRunId(researchRunId: ResearchRunId): Promise<readonly Finding[]> {
    const rows = await this.db.select()
      .from(researchFindings)
      .where(eq(researchFindings.researchRunId, researchRunId))
      .orderBy(asc(researchFindings.createdAt), asc(researchFindings.id));
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  private async hydrate(row: FindingRow): Promise<Finding> {
    const references = await this.db.select({ claimId: researchFindingClaims.claimId })
      .from(researchFindingClaims)
      .where(eq(researchFindingClaims.findingId, row.id))
      .orderBy(asc(researchFindingClaims.position));
    return createFinding({
      id: row.id,
      researchRunId: row.researchRunId,
      type: row.type,
      title: row.title,
      description: row.description,
      claimIds: references.map((reference) => reference.claimId),
      createdAt: row.createdAt,
    });
  }
}
