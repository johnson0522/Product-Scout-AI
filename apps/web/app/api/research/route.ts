import { getAgentGateway } from '../../../lib/agent-gateway';
import { createResearchPostHandler } from './handler';

export const runtime = 'nodejs';

export const POST = createResearchPostHandler(getAgentGateway);
