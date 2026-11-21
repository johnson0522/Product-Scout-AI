/** JSON is validated at the browser boundary, never cast to a domain object. */
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid service response');
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid text in service response');
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid number in service response');
  return value;
}
export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid list in service response');
  return value;
}
export function records(value: unknown): readonly Record<string, unknown>[] { return list(value).map(object); }

export async function requestJson(url: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return {};
  const data = object(await response.json());
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  return data;
}

export interface ProjectSummary { readonly id: string; readonly name: string }
export interface RunSummary {
  readonly id: string;
  readonly goal: string;
  readonly status: string;
  readonly errorMessage?: string;
  readonly steps: readonly { readonly type: string; readonly status: string }[];
}
export function projectSummary(value: unknown): ProjectSummary {
  const row = object(value);
  return { id: text(row.id), name: text(row.name) };
}
export function runSummary(value: unknown): RunSummary {
  const row = object(value);
  const status = text(row.status);
  if (!['pending', 'running', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error('Unknown research status');
  return {
    id: text(row.id), goal: text(row.goal), status,
    ...(row.errorMessage === undefined ? {} : { errorMessage: text(row.errorMessage) }),
    steps: records(row.steps).map((step) => ({ type: text(step.type), status: text(step.status) })),
  };
}

export const STEP_LABELS: Readonly<Record<string, string>> = {
  market_understanding: 'Market understanding', pain_point_research: 'Pain points',
  competitor_research: 'Competitors', market_signal_research: 'Market signals',
  opportunity_analysis: 'Opportunity analysis', report_generation: 'Report and validation plan',
};
export const TERMINAL_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled'];
