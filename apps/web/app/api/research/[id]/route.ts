import { getProductApi } from '../../../../lib/agent-gateway';
import { apiRoute, publicResearchRun } from '../../../../lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = apiRoute(getProductApi, async (api, _request, context: { params: { id: string } }) => {
  const run = await api.requireRun(context.params.id);
  return Response.json({ researchRun: publicResearchRun(run) });
});
