import { getProductApi } from '../../../../../lib/agent-gateway';
import { apiRoute } from '../../../../../lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = apiRoute(getProductApi, async (api, _request, context: { params: { id: string } }) =>
  Response.json(await api.evidenceForRun(context.params.id)));
