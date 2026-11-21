import { getProductApi } from '../../../../../lib/agent-gateway';
import { apiRoute } from '../../../../../lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = apiRoute(getProductApi, async (api, _request, context: { params: { id: string } }) => {
  const run = await api.requireRun(context.params.id);
  const [reports, opportunities, validationPlans] = await Promise.all([
    api.data.reports.listByResearchRunId(run.id),
    api.data.opportunities.listByResearchRunId(run.id),
    api.data.validationPlans.listByResearchRunId(run.id),
  ]);
  return Response.json({ status: run.status, reports, opportunities, validationPlans });
});
