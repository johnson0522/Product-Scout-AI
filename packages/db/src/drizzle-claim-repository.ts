import { asc, eq, sql } from 'drizzle-orm';
import type { ResearchRunId } from '@product-scout/domain';
import {
  createClaim,
  type Claim,
  type ClaimId,
  type ClaimRepository,
} from '@product-scout/evidence';

import type { Database } from './index';
import { claimEvidenceRefs, claims } from './schema';

type ClaimRow = typeof claims.$inferSelect;

export class DrizzleClaimRepository implements ClaimRepository {
  public constructor(private readonly db: Database) {}

  public async create(claim: Claim): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction.insert(claims).values({
        id: claim.id,
        researchRunId: claim.researchRunId,
        text: claim.text,
        createdAt: sql`${claim.createdAt.toISOString()}`,
      });
      await transaction.insert(claimEvidenceRefs).values(
        claim.evidenceRefs.map((reference, position) => ({
          claimId: claim.id,
          evidenceId: reference.evidenceId,
          position,
        })),
      );
    });
  }

  public async getById(id: ClaimId): Promise<Claim | null> {
    const rows = await this.db.select().from(claims).where(eq(claims.id, id)).limit(1);
    const row = rows[0];
    return row ? this.hydrate(row) : null;
  }

  public async listByResearchRunId(researchRunId: ResearchRunId): Promise<readonly Claim[]> {
    const rows = await this.db.select()
      .from(claims)
      .where(eq(claims.researchRunId, researchRunId))
      .orderBy(asc(claims.createdAt), asc(claims.id));
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  private async hydrate(row: ClaimRow): Promise<Claim> {
    const references = await this.db.select({ evidenceId: claimEvidenceRefs.evidenceId })
      .from(claimEvidenceRefs)
      .where(eq(claimEvidenceRefs.claimId, row.id))
      .orderBy(asc(claimEvidenceRefs.position));
    return createClaim({
      id: row.id,
      researchRunId: row.researchRunId,
      text: row.text,
      evidenceRefs: references,
      createdAt: row.createdAt,
    });
  }
}
