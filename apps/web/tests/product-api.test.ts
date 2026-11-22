import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Project, ResearchRun } from '@product-scout/domain';
import { ProductApi, apiRoute, readObject, requireLocalRequest, type ProductData } from '../lib/product-api';

const owner = '10000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000002';
const runId = '30000000-0000-4000-8000-000000000003';
function fixture() {
  const project: Project = { id: projectId, ownerId: owner, name: 'Project', status: 'active', createdAt: new Date(), updatedAt: new Date() };
  const run: ResearchRun = { id: runId, projectId, goal: 'Research', status: 'running', steps: [], agentSessionId: null, runtimeMetadata: null, createdAt: new Date() };
  const data: ProductData = {
    projects: { findById: async () => project, listByOwnerId: async () => [project], create: async () => project },
    runs: { findById: async () => run, listByProjectId: async () => [run] },
    acquisitions: { listByResearchRunId: async () => [{ id: 'acq', researchRunId: runId, evidenceId: 'e1', workflowInvocationKey: 'i', stepId: 'market_understanding', sourceFingerprint: 'fp', capturedAt: new Date() }] },
    evidence: { getById: async () => ({ id: 'e1', title: 'Original', excerpt: 'Source excerpt', source: { url: 'https://example.com' }, retrievedAt: new Date() }) },
    claims: { listByResearchRunId: async () => [] }, findings: { listByResearchRunId: async () => [] },
    reports: { listByResearchRunId: async () => [] }, opportunities: { listByResearchRunId: async () => [] }, validationPlans: { listByResearchRunId: async () => [] },
  };
  return { project, run, data, api: new ProductApi(data, owner) };
}

describe('local Product API authorization and errors', () => {
  it('authorizes own run and scopes evidence through acquisition records', async () => {
    const { api } = fixture();
    expect((await api.requireRun(runId)).id).toBe(runId);
    const trace = await api.evidenceForRun(runId);
    expect(trace.evidence).toHaveLength(1);
    expect(trace.evidence[0]?.source.url).toBe('https://example.com');
  });
  it('rejects foreign projects/runs before gateway execution', async () => {
    const { data } = fixture();
    const foreignApi = new ProductApi(data, '40000000-0000-4000-8000-000000000004');
    const gateway = { createResearch: vi.fn(), startResearch: vi.fn(), cancelResearch: vi.fn() };
    await expect(foreignApi.requireRun(runId)).rejects.toMatchObject({ status: 404 });
    await expect(foreignApi.scopedGateway(gateway).createResearch({ projectId, goal: 'Unauthorized' })).rejects.toMatchObject({ status: 404 });
    expect(gateway.createResearch).not.toHaveBeenCalled();
    await expect(foreignApi.scopedGateway(gateway).cancelResearch(runId)).rejects.toMatchObject({ status: 404 });
    expect(gateway.cancelResearch).not.toHaveBeenCalled();
  });
  it('does not disguise query errors as not-found or expose database details', async () => {
    const { api } = fixture();
    api.data.runs.findById = async () => { throw new Error('secret connection detail'); };
    const route = apiRoute(() => api, async (product) => Response.json(await product.requireRun(runId)));
    const response = await route(new Request('http://localhost/api/research'), undefined);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
  it('reports missing acquired Evidence instead of silently dropping it', async () => {
    const { data } = fixture();
    const api = new ProductApi({ ...data, evidence: { getById: async () => null } }, owner);
    await expect(api.evidenceForRun(runId)).rejects.toThrow('missing');
  });
  it('validates IDs, request size and JSON', async () => {
    const { api } = fixture();
    await expect(api.requireRun('invalid')).rejects.toMatchObject({ status: 400 });
    await expect(readObject(new Request('http://localhost', { method: 'POST', body: '[' }))).rejects.toMatchObject({ status: 400 });
    await expect(readObject(new Request('http://localhost', { method: 'POST', body: 'a'.repeat(16_385) }))).rejects.toMatchObject({ status: 413 });
  });
  it.each([
    new Request('http://public.example/api/projects'),
    new Request('http://localhost/api/projects', { headers: { Origin: 'https://attacker.example' } }),
    new Request('http://localhost/api/projects', { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
  ])('rejects remote or cross-site requests', (request) => {
    expect(() => requireLocalRequest(request)).toThrow();
  });
  it.each(['127.0.0.1:3000', 'localhost:3000', '[::1]:3000'])(
    'accepts the browser origin for %s after NextURL normalization', (host) => {
      const request = new NextRequest(`http://${host}/api/projects`, {
        method: 'POST',
        headers: { Host: host, Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' },
      });
      expect(new URL(request.url).hostname).toBe('localhost');
      expect(() => requireLocalRequest(request)).not.toThrow();
    },
  );
  it.each<Record<string, string>>([
    { Host: '127.0.0.1:3000', Origin: 'http://localhost:3000' },
    { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3001' },
    { Host: '127.0.0.1:3000', Origin: 'https://127.0.0.1:3000' },
    { Host: '127.0.0.1:3000', Origin: 'https://attacker.example' },
    { Host: '127.0.0.1:3000', Origin: 'null' },
    { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'attacker.example', Origin: 'http://attacker.example' },
    { Host: 'localhost.attacker.example', Origin: 'http://localhost.attacker.example' },
    { Host: 'localhost:99999' },
    { Host: 'localhost:3000@attacker.example' },
    { Host: 'localhost:3000/path' },
    { Host: '127.0.0.1:3000', Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' },
  ])('rejects a mismatched origin or invalid host: %j', (headers) => {
    const request = new NextRequest('http://127.0.0.1:3000/api/projects', { headers });
    expect(() => requireLocalRequest(request)).toThrow();
  });
  it('allows project creation through the route boundary with a normalized NextRequest', async () => {
    const { api, project } = fixture();
    const create = vi.spyOn(api.data.projects, 'create');
    const route = apiRoute(() => api, async (product, request) => {
      const body = await readObject(request);
      return Response.json({ project: await product.data.projects.create({ ownerId: owner, name: String(body.name) }) }, { status: 201 });
    });
    const response = await route(new NextRequest('http://127.0.0.1:3000/api/projects', {
      method: 'POST',
      headers: { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project' }),
    }), undefined);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ project: JSON.parse(JSON.stringify(project)) });
    expect(create).toHaveBeenCalledWith({ ownerId: owner, name: 'Project' });
  });
});
