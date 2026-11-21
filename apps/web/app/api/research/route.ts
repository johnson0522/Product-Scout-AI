import { getAgentGateway, getProductApi } from '../../../lib/agent-gateway';
import { apiRoute } from '../../../lib/product-api';
import { createResearchPostHandler } from './handler';

export const runtime = 'nodejs';

export const POST = apiRoute(getProductApi, async (api, request) =>
  createResearchPostHandler(() => api.scopedGateway(getAgentGateway()))(request));
