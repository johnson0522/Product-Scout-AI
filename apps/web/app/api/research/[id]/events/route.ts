import { getProductApi, getResearchEventDependencies } from '../../../../../lib/agent-gateway';
import { apiRoute } from '../../../../../lib/product-api';
import { createResearchEventsGetHandler } from '../../../../../lib/research-events';

export const runtime = 'nodejs';

export const GET = apiRoute(getProductApi, async (api, request, context: { params: { id: string } }) => {
  await api.requireRun(context.params.id);
  return createResearchEventsGetHandler(getResearchEventDependencies)(request, context);
});
