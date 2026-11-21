import { getProductApi } from '../../../lib/agent-gateway';
import { apiRoute, readObject, requiredText } from '../../../lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiRoute(getProductApi, async (api) =>
  Response.json({ projects: await api.data.projects.listByOwnerId(api.ownerId) }));

export const POST = apiRoute(getProductApi, async (api, request) => {
  const body = await readObject(request);
  const name = requiredText(body.name, 'name', 255);
  const description = body.description === undefined ? undefined : requiredText(body.description, 'description', 4000);
  const project = await api.data.projects.create({ ownerId: api.ownerId, name, description });
  return Response.json({ project }, { status: 201 });
});
