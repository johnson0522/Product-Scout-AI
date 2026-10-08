import { NextResponse } from 'next/server';

import type { AgentGateway } from '@product-scout/research';
import {
  AgentGatewayRuntimeError,
  InvalidResearchTransitionError,
  ResearchRunNotFoundError,
} from '@product-scout/research';

export interface CancelRouteContext {
  readonly params: {
    readonly id: string;
  };
}

export function createCancelResearchPostHandler(
  resolveGateway: () => AgentGateway,
): (
  request: Request,
  context: CancelRouteContext,
) => Promise<NextResponse> {
  return async (
    _request: Request,
    context: CancelRouteContext,
  ): Promise<NextResponse> => {
    try {
      await resolveGateway().cancelResearch(context.params.id);
      return new NextResponse(null, { status: 204 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Cancellation failed';
      const status = error instanceof ResearchRunNotFoundError
        ? 404
        : error instanceof InvalidResearchTransitionError
          ? 409
          : error instanceof AgentGatewayRuntimeError
            ? 502
            : 500;
      return NextResponse.json({ error: message }, { status });
    }
  };
}
