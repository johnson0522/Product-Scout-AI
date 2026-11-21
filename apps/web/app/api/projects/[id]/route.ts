import { getProductApi } from '../../../../lib/agent-gateway';
import { apiRoute, publicResearchRun } from '../../../../lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = apiRoute(getProductApi, async (api, _request, context: { params: { id: string } }) => {
  const project = await api.requireProject(context.params.id);
  const runs = await api.data.runs.listByProjectId(project.id);
  return Response.json({ project, runs: runs.map(publicResearchRun) });
});
