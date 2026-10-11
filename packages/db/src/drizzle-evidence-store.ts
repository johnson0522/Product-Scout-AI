import { eq, sql } from 'drizzle-orm';
import {
  createEvidence,
  type Evidence,
  type EvidenceId,
  type EvidenceRepository,
} from '@product-scout/evidence';

import type { Database } from './index';
import { evidenceStore } from './schema';

type EvidenceStoreRow = typeof evidenceStore.$inferSelect;

function mapEvidenceStoreRow(row: EvidenceStoreRow): Evidence {
  return createEvidence({
    id: row.id,
    source: {
      url: row.sourceUrl,
      ...(row.sourceTitle === null ? {} : { title: row.sourceTitle }),
      ...(row.sourceDomain === null ? {} : { domain: row.sourceDomain }),
    },
    title: row.title,
    excerpt: row.excerpt,
    retrievedAt: row.retrievedAt,
  });
}

/** PostgreSQL/Drizzle implementation of the C2 EvidenceRepository contract. */
export class DrizzleEvidenceStoreRepository implements EvidenceRepository {
  public constructor(private readonly db: Database) {}

  public async create(evidence: Evidence): Promise<void> {
    await this.db.insert(evidenceStore).values({
      id: evidence.id,
      sourceUrl: evidence.source.url,
      sourceTitle: evidence.source.title,
      sourceDomain: evidence.source.domain,
      title: evidence.title,
      excerpt: evidence.excerpt,
      // Drizzle 0.29 maps Date values through toUTCString(), which drops
      // milliseconds. Bind the ISO value as SQL so timestamptz preserves the
      // Evidence retrieval timestamp semantics.
      retrievedAt: sql`${evidence.retrievedAt.toISOString()}`,
    });
  }

  public async getById(id: EvidenceId): Promise<Evidence | null> {
    const rows = await this.db.select()
      .from(evidenceStore)
      .where(eq(evidenceStore.id, id))
      .limit(1);
    return rows[0] ? mapEvidenceStoreRow(rows[0]) : null;
  }
}
