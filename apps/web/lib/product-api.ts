import type { Finding, Opportunity, Project, ResearchReport, ResearchRun, ValidationPlan } from '@product-scout/domain';
import type { Claim, Evidence, EvidenceAcquisition } from '@product-scout/evidence';
import type { AgentGateway } from '@product-scout/research';

export interface ProductData {
  readonly projects: {
    findById(id: string): Promise<Project | null>;
    listByOwnerId(ownerId: string): Promise<readonly Project[]>;
    create(input: { ownerId: string; name: string; description?: string }): Promise<Project>;
  };
  readonly runs: {
    findById(id: string): Promise<ResearchRun | null>;
    listByProjectId(id: string): Promise<readonly ResearchRun[]>;
  };
  readonly acquisitions: { listByResearchRunId(id: string): Promise<readonly EvidenceAcquisition[]> };
  readonly evidence: { getById(id: string): Promise<Evidence | null> };
  readonly claims: { listByResearchRunId(id: string): Promise<readonly Claim[]> };
  readonly findings: { listByResearchRunId(id: string): Promise<readonly Finding[]> };
  readonly opportunities: { listByResearchRunId(id: string): Promise<readonly Opportunity[]> };
  readonly reports: { listByResearchRunId(id: string): Promise<readonly ResearchReport[]> };
  readonly validationPlans: { listByResearchRunId(id: string): Promise<readonly ValidationPlan[]> };
}

export class ApiError extends Error {
  public constructor(public readonly status: number, message: string) { super(message); }
}

export function publicResearchRun(run: ResearchRun): Omit<ResearchRun, 'agentSessionId' | 'runtimeMetadata'> {
  const { agentSessionId: _session, runtimeMetadata: _metadata, ...result } = run;
  return result;
}

export function requireId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(400, 'Invalid identifier');
  }
  return id;
}

export function requireLocalRequest(request: Request): void {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ApiError(403, 'V0.1 requires a local connection');
  }
  // NextURL normalizes loopback addresses to localhost. Host retains the
  // browser-facing authority; validate it before comparing the exact origin.
  // Forwarded headers are deliberately not trusted in this local-only app.
  const host = request.headers.get('host');
  let expectedOrigin = url.origin;
  if (host !== null) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) {
      throw new ApiError(403, 'V0.1 requires a local connection');
    }
    try {
      expectedOrigin = new URL(`${url.protocol}//${host}`).origin;
    } catch {
      throw new ApiError(403, 'Invalid local host');
    }
  }
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== expectedOrigin) throw new ApiError(403, 'Cross-origin request rejected');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'Cross-site request rejected');
}

export class ProductApi {
  public constructor(public readonly data: ProductData, public readonly ownerId: string) {
    requireId(ownerId);
  }

  public async requireProject(id: string): Promise<Project> {
    const project = await this.data.projects.findById(requireId(id));
    if (project === null || project.ownerId !== this.ownerId) throw new ApiError(404, 'Project not found');
    return project;
  }

  public async requireRun(id: string): Promise<ResearchRun> {
    const run = await this.data.runs.findById(requireId(id));
    if (run === null) throw new ApiError(404, 'Research run not found');
    await this.requireProject(run.projectId);
    return run;
  }

  public async evidenceForRun(id: string) {
    await this.requireRun(id);
    const acquisitions = await this.data.acquisitions.listByResearchRunId(id);
    const ids = [...new Set(acquisitions.map((item) => item.evidenceId))];
    const evidence = await Promise.all(ids.map(async (evidenceId) => {
      const item = await this.data.evidence.getById(evidenceId);
      if (item === null) throw new Error('Acquired Evidence is missing');
      return item;
    }));
    const [claims, findings] = await Promise.all([
      this.data.claims.listByResearchRunId(id), this.data.findings.listByResearchRunId(id),
    ]);
    return { evidence, acquisitions, claims, findings };
  }

  public scopedGateway(gateway: AgentGateway): AgentGateway {
    return {
      createResearch: async (input) => {
        await this.requireProject(input.projectId);
        return gateway.createResearch(input);
      },
      startResearch: async (id) => { await this.requireRun(id); await gateway.startResearch(id); },
      cancelResearch: async (id) => { await this.requireRun(id); await gateway.cancelResearch(id); },
    };
  }
}

export function apiRoute<Context>(
  resolve: () => ProductApi,
  action: (api: ProductApi, request: Request, context: Context) => Promise<Response>,
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    try {
      requireLocalRequest(request);
      const response = await action(resolve(), request, context);
      if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (error: unknown) {
      if (!(error instanceof ApiError)) console.error('Product API failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
      return Response.json({ error: error instanceof ApiError ? error.message : 'Service unavailable' }, {
        status: error instanceof ApiError ? error.status : 503, headers: { 'Cache-Control': 'no-store' },
      });
    }
  };
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader !== undefined) {
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 16_384) { await reader.cancel(); throw new ApiError(413, 'Request body too large'); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiError(400, 'Invalid JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'Expected an object');
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new ApiError(400, `${field} must contain 1–${max} characters`);
  }
  return value.trim();
}
