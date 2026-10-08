import { getAgentGateway } from '../../../../../lib/agent-gateway';
import { createCancelResearchPostHandler } from './handler';

export const runtime = 'nodejs';

export const POST = createCancelResearchPostHandler(getAgentGateway);
