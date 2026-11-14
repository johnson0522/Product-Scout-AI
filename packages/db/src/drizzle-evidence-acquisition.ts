import { and, asc, eq, sql } from 'drizzle-orm';
import type { ResearchRunId } from '@product-scout/domain';
import {
  createEvidence,
  createEvidenceAcquisition,
  EvidenceIdentityConflictError,
  validateAcquireEvidenceInput,
  validateEvidenceAcquisitionScope,
  type AcquireEvidenceInput,
  type AcquireEvidenceResult,
  type Evidence,
  type EvidenceAcquisition,
  type EvidenceAcquisitionRepository,
  type EvidenceAcquisitionScope,
  type EvidenceId,
} from '@product-scout/evidence';

import type { Database } from './index';
import { evidenceAcquisitions, evidenceStore } from './schema';

type EvidenceRow = typeof evidenceStore.$inferSelect;
type AcquisitionRow = typeof evidenceAcquisitions.$inferSelect;

class AcquisitionScopeRace extends Error {}

export class DrizzleEvidenceAcquisitionRepository
implements EvidenceAcquisitionRepository {
  public constructor(private readonly db: Database) {}

  public async acquire(input: AcquireEvidenceInput): Promise<AcquireEvidenceResult> {
    const validInput = validateAcquireEvidenceInput(input);
    try {
      return await this.db.transaction(async (transaction) => {
        const existingAcquisitions = await transaction.select()
          .from(evidenceAcquisitions)
          .where(scopeCondition(validInput))
          .limit(1);
        const existingAcquisition = existingAcquisitions[0];
        if (existingAcquisition !== undefined) {
          const evidence = await requireEvidence(transaction, existingAcquisition.evidenceId);
          return {
            status: 'existing' as const,
            evidence,
            acquisition: mapAcquisition(existingAcquisition),
          };
        }

        const insertedEvidence = await transaction.insert(evidenceStore).values({
          id: validInput.evidence.id,
          sourceUrl: validInput.evidence.source.url,
          sourceTitle: validInput.evidence.source.title,
          sourceDomain: validInput.evidence.source.domain,
          title: validInput.evidence.title,
          excerpt: validInput.evidence.excerpt,
          retrievedAt: sql`${validInput.evidence.retrievedAt.toISOString()}`,
        }).onConflictDoNothing().returning({ id: evidenceStore.id });

        const evidence = insertedEvidence.length === 0
          ? await requireEvidence(transaction, validInput.evidence.id)
          : validInput.evidence;
        if (!sameEvidence(evidence, validInput.evidence)) {
          throw new EvidenceIdentityConflictError(validInput.evidence.id);
        }

        const insertedAcquisitions = await transaction.insert(evidenceAcquisitions).values({
          researchRunId: validInput.researchRunId,
          evidenceId: evidence.id,
          workflowInvocationKey: validInput.workflowInvocationKey,
          stepId: validInput.stepId,
          sourceFingerprint: validInput.sourceFingerprint,
          capturedAt: sql`${validInput.capturedAt.toISOString()}`,
        }).onConflictDoNothing().returning();
        const insertedAcquisition = insertedAcquisitions[0];
        if (insertedAcquisition === undefined) {
          throw new AcquisitionScopeRace();
        }

        return {
          status: 'created' as const,
          evidence,
          acquisition: mapAcquisition(insertedAcquisition),
        };
      });
    } catch (error: unknown) {
      if (!(error instanceof AcquisitionScopeRace)) throw error;
      const existing = await this.getByScope(validInput);
      if (existing === null) {
        throw new Error('Evidence acquisition scope conflict could not be resolved');
      }
      return {
        status: 'existing',
        evidence: await this.requireEvidence(existing.evidenceId),
        acquisition: existing,
      };
    }
  }

  public async getByScope(
    scope: EvidenceAcquisitionScope,
  ): Promise<EvidenceAcquisition | null> {
    const validScope = validateEvidenceAcquisitionScope(scope);
    const rows = await this.db.select()
      .from(evidenceAcquisitions)
      .where(scopeCondition(validScope))
      .limit(1);
    return rows[0] ? mapAcquisition(rows[0]) : null;
  }

  public async listByResearchRunId(
    researchRunId: ResearchRunId,
  ): Promise<readonly EvidenceAcquisition[]> {
    const rows = await this.db.select()
      .from(evidenceAcquisitions)
      .where(eq(evidenceAcquisitions.researchRunId, researchRunId))
      .orderBy(asc(evidenceAcquisitions.capturedAt), asc(evidenceAcquisitions.id));
    return rows.map(mapAcquisition);
  }

  public async isAssociatedWithResearchRun(
    researchRunId: ResearchRunId,
    evidenceId: EvidenceId,
  ): Promise<boolean> {
    const rows = await this.db.select({ id: evidenceAcquisitions.id })
      .from(evidenceAcquisitions)
      .where(and(
        eq(evidenceAcquisitions.researchRunId, researchRunId),
        eq(evidenceAcquisitions.evidenceId, evidenceId),
      ))
      .limit(1);
    return rows.length > 0;
  }

  private async requireEvidence(id: EvidenceId): Promise<Evidence> {
    return requireEvidence(this.db, id);
  }
}

function scopeCondition(scope: EvidenceAcquisitionScope) {
  return and(
    eq(evidenceAcquisitions.researchRunId, scope.researchRunId),
    eq(evidenceAcquisitions.workflowInvocationKey, scope.workflowInvocationKey),
    eq(evidenceAcquisitions.stepId, scope.stepId),
    eq(evidenceAcquisitions.sourceFingerprint, scope.sourceFingerprint),
  );
}

async function requireEvidence(
  database: Pick<Database, 'select'>,
  id: EvidenceId,
): Promise<Evidence> {
  const rows = await database.select().from(evidenceStore)
    .where(eq(evidenceStore.id, id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error(`Evidence not found: ${id}`);
  return mapEvidence(row);
}

function mapEvidence(row: EvidenceRow): Evidence {
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

function mapAcquisition(row: AcquisitionRow): EvidenceAcquisition {
  return createEvidenceAcquisition({
    id: row.id,
    researchRunId: row.researchRunId,
    evidenceId: row.evidenceId,
    workflowInvocationKey: row.workflowInvocationKey,
    stepId: row.stepId,
    sourceFingerprint: row.sourceFingerprint,
    capturedAt: row.capturedAt,
  });
}

function sameEvidence(left: Evidence, right: Evidence): boolean {
  return left.id === right.id
    && left.source.url === right.source.url
    && (left.source.title ?? null) === (right.source.title ?? null)
    && (left.source.domain ?? null) === (right.source.domain ?? null)
    && left.title === right.title
    && left.excerpt === right.excerpt
    && left.retrievedAt.getTime() === right.retrievedAt.getTime();
}

