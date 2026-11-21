import { getAgentGateway, getProductApi } from '../../../../../lib/agent-gateway';
import { apiRoute } from '../../../../../lib/product-api';
import { createCancelResearchPostHandler } from './handler';

export const runtime = 'nodejs';

export const POST = apiRoute(getProductApi, async (api, request, context: { params: { id: string } }) => {
  await api.requireRun(context.params.id);
  return createCancelResearchPostHandler(() => api.scopedGateway(getAgentGateway()))(request, context);
});
