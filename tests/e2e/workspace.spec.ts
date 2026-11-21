import { expect, test, type Page } from '@playwright/test';

const projectId = '20000000-0000-4000-8000-000000000002';
const runId = '30000000-0000-4000-8000-000000000003';

// Browser contract tests use HTTP fixtures, not a fake production runtime flag.
// Real PostgreSQL and live-provider acceptance are separate commands.
async function mockApi(page: Page, status: 'completed' | 'running' = 'completed') {
  let state: string = status;
  const project = { id: projectId, name: 'Operations research' };
  const run = () => ({ id: runId, projectId, goal: 'Find recurring operations pain', status: state, steps: [{ type: 'market_understanding', status: state === 'running' ? 'running' : 'completed' }] });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/events')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `id: 1\nevent: research.step.started\ndata: ${JSON.stringify({ eventId: 'step-1', stepType: 'market_understanding' })}\n\n` }); return;
    }
    if (url.pathname.endsWith('/cancel')) { state = 'cancelled'; await route.fulfill({ status: 204 }); return; }
    if (url.pathname === '/api/projects') { await route.fulfill({ json: route.request().method() === 'POST' ? { project } : { projects: [] } }); return; }
    if (url.pathname === `/api/projects/${projectId}`) { await route.fulfill({ json: { project, runs: [] } }); return; }
    if (url.pathname === '/api/research') { await route.fulfill({ status: 201, json: { researchRunId: runId } }); return; }
    if (url.pathname === `/api/research/${runId}`) { await route.fulfill({ json: { researchRun: run() } }); return; }
    if (url.pathname.endsWith('/evidence')) { await route.fulfill({ json: { acquisitions: [], evidence: [{ id: 'e1', title: 'Original customer source', excerpt: '<script>window.injected = true</script> Users report repeated reconciliation work.', source: { url: 'https://example.com/original' }, retrievedAt: '2026-11-16T00:00:00.000Z' }], claims: [{ id: 'c1', text: 'Recurring work is reported', evidenceRefs: [{ evidenceId: 'e1' }] }], findings: [{ id: 'f1', title: 'Recurring reconciliation', description: 'Repeated work appears in independent sources.', claimIds: ['c1'] }] } }); return; }
    if (url.pathname.endsWith('/report')) {
      await route.fulfill({ json: {
        reports: state === 'completed' ? [{ id: 'r1', title: 'Operations report', executiveSummary: 'A focused reconciliation workflow merits validation.', sections: [{ id: 'summary', title: 'Market findings', content: 'Evidence supports a narrow test.', findingIds: ['f1'], opportunityIds: [] }], limitations: ['No willingness-to-pay interview.'] }] : [],
        opportunities: state === 'completed' ? [{ id: 'o1', title: 'Reconciliation assistant', targetCustomer: 'Operations teams', problem: 'Recurring manual work', solution: 'Assisted reconciliation', whyNow: 'Workflow complexity', monetization: 'Monthly subscription', mvp: 'Import and compare', confidence: 70, evidenceIds: ['e1'], score: { total: 70, breakdown: Object.fromEntries(Object.entries({ pain: .2, willingnessToPay: .2, frequency: .15, market: .15, competition: .1, acquisition: .1, feasibility: .1 }).map(([key, weight]) => [key, { value: 70, weight, contribution: 70 * weight }])) }, scoreReasoning: Object.fromEntries(['pain', 'willingnessToPay', 'frequency', 'market', 'competition', 'acquisition', 'feasibility'].map((key) => [key, 'An evidence-backed factor explanation.'])) }] : [],
        validationPlans: state === 'completed' ? [{ id: 'v1', days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, objective: `Validation objective ${i + 1}`, activities: ['Interview target users'], successCriteria: ['Three specific examples'] })) }] : [],
      } }); return;
    }
    await route.fulfill({ status: 404, json: { error: 'not found' } });
  });
}

test('create project, start research, inspect report, plan and evidence trace', async ({ page }) => {
  await mockApi(page);
  await page.goto('/projects');
  await page.getByLabel('Project name').fill('Operations research');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByLabel('Research goal').fill('Find recurring operations pain');
  await page.getByRole('button', { name: 'Start research', exact: true }).click();
  await expect(page).toHaveURL(`/research/${runId}`);
  await expect(page.getByRole('heading', { name: 'Operations report' })).toBeVisible();
  await expect(page.getByText('Day 7 · Validation objective 7')).toBeVisible();
  await expect(page.getByText('70/100', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'An evidence-backed factor explanation.', exact: true })).toHaveCount(7);
  await expect(page.getByText('Import and compare', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '1', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Recurring reconciliation' })).toBeVisible();
  await expect(page.getByText('<script>window.injected = true</script>', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(window, 'injected'))).toBe(false);
  await expect(page.getByRole('link', { name: 'https://example.com/original' })).toHaveAttribute('rel', 'noopener noreferrer');
});

test('shows live activity and can cancel an active research run', async ({ page }) => {
  await mockApi(page, 'running');
  await page.goto(`/research/${runId}`);
  await expect(page.getByText('Recent activity (1)')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel research' }).click();
  await expect(page.locator('.toolbar .status')).toHaveText('cancelled');
  await expect(page.getByRole('button', { name: 'Cancel research' })).toHaveCount(0);
});

test('shows actionable API failure without an invented project', async ({ page }) => {
  await page.route('**/api/projects', (route) => route.fulfill({ status: 503, json: { error: 'Service unavailable' } }));
  await page.goto('/projects');
  await expect(page.getByRole('alert').filter({ hasText: 'Service unavailable' })).toHaveText('Service unavailable');
  await expect(page.getByText('Create a project to begin.')).toBeVisible();
});

test('loads the actual production API bundle and fails closed without configuration', async ({ request }) => {
  // No route interception: this exercises native DSH SDK loading in Next's
  // production bundle without starting DSH, Search, or a database connection.
  const response = await request.get('/api/projects');
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ error: 'Service unavailable' });
  const crossOrigin = await request.post('/api/projects', {
    headers: { Origin: 'https://attacker.example' }, data: { name: 'Untrusted request' },
  });
  expect(crossOrigin.status()).toBe(403);
});
