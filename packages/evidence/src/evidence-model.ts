import type { EvidenceId as DomainEvidenceId } from '@product-scout/domain';

/** Stable identifier for an evidence object. It is never derived from a URL or title. */
export type EvidenceId = DomainEvidenceId;

export interface EvidenceSource {
  readonly url: string;
  readonly title?: string;
  readonly domain?: string;
}

/**
 * A preserved source excerpt. Evidence is a research object, not a raw search
 * result or an LLM-generated summary.
 */
export interface Evidence {
  readonly id: EvidenceId;
  readonly source: EvidenceSource;
  readonly title: string;
  readonly excerpt: string;
  readonly retrievedAt: Date;
}

/** A traceability link stores an id only; it never embeds an evidence snapshot. */
export interface EvidenceReference {
  readonly evidenceId: EvidenceId;
}

/** Minimal Claim contract without introducing a Claim aggregate. */
export interface ClaimEvidenceLinks {
  readonly evidenceRefs: readonly EvidenceReference[];
}

export interface CreateEvidenceInput {
  readonly id: EvidenceId;
  readonly source: EvidenceSource;
  readonly title: string;
  readonly excerpt: string;
  readonly retrievedAt: Date;
}

export class InvalidEvidenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidEvidenceError';
  }
}

export function createEvidence(input: CreateEvidenceInput): Evidence {
  const id = requireNonEmpty(input.id, 'id');
  const source = createEvidenceSource(input.source);
  const title = requireNonEmpty(input.title, 'title');
  const excerpt = requireNonEmpty(input.excerpt, 'excerpt');
  if (!(input.retrievedAt instanceof Date) || Number.isNaN(input.retrievedAt.getTime())) {
    throw new InvalidEvidenceError('retrievedAt must be a valid Date');
  }

  return {
    id,
    source,
    title,
    excerpt,
    retrievedAt: new Date(input.retrievedAt.getTime()),
  };
}

export function createEvidenceSource(source: EvidenceSource): EvidenceSource {
  const url = requireNonEmpty(source.url, 'source.url');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error: unknown) {
    throw new InvalidEvidenceError(`source.url must be an http(s) URL: ${errorMessage(error)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidEvidenceError('source.url must use http:// or https://');
  }

  return {
    url,
    ...(source.title === undefined ? {} : { title: requireNonEmpty(source.title, 'source.title') }),
    ...(source.domain === undefined ? {} : { domain: requireNonEmpty(source.domain, 'source.domain') }),
  };
}

export function createEvidenceReference(evidenceId: EvidenceId): EvidenceReference {
  return { evidenceId: requireNonEmpty(evidenceId, 'evidenceId') };
}

export function createClaimEvidenceLinks(
  evidenceRefs: readonly EvidenceReference[],
): ClaimEvidenceLinks {
  return {
    evidenceRefs: evidenceRefs.map((reference) =>
      createEvidenceReference(reference.evidenceId)),
  };
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidEvidenceError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
