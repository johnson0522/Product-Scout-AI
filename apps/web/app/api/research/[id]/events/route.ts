import { getResearchEventDependencies } from '../../../../../lib/agent-gateway';
import { createResearchEventsGetHandler } from '../../../../../lib/research-events';

export const runtime = 'nodejs';

export const GET = createResearchEventsGetHandler(getResearchEventDependencies);
