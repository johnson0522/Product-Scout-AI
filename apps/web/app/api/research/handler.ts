import { NextResponse } from 'next/server';

import type { ResearchRun } from '@product-scout/domain';
import type { AgentGateway, CreateResearchInput } from '@product-scout/research';
import { AgentGatewayRuntimeError } from '@product-scout/research';

export function createResearchPostHandler(
  resolveGateway: () => AgentGateway,
): (request: Request) => Promise<NextResponse> {
  return async (request: Request): Promise<NextResponse> => {
    let input: CreateResearchInput;
    try {
      input = parseCreateResearchInput(await request.json());
    } catch (error: unknown) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid request body' },
        { status: 400 },
      );
    }

    let run: ResearchRun | undefined;
    try {
      const gateway = resolveGateway();
      run = await gateway.createResearch(input);
      await gateway.startResearch(run.id);
      return NextResponse.json({ researchRunId: run.id }, { status: 201 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Research failed';
      const body = run === undefined
        ? { error: message }
        : { error: message, researchRunId: run.id };
      return NextResponse.json(
        body,
        { status: error instanceof AgentGatewayRuntimeError ? 502 : 500 },
      );
    }
  };
}

function parseCreateResearchInput(value: unknown): CreateResearchInput {
  if (!isRecord(value)) {
    throw new TypeError('Request body must be a JSON object');
  }
  if (typeof value.projectId !== 'string' || value.projectId.trim() === '') {
    throw new TypeError('projectId must be a non-empty string');
  }
  if (typeof value.goal !== 'string' || value.goal.trim() === '') {
    throw new TypeError('goal must be a non-empty string');
  }

  const constraints = parseConstraints(value.constraints);
  return {
    projectId: value.projectId,
    goal: value.goal,
    ...(constraints === undefined ? {} : { constraints }),
  };
}

function parseConstraints(
  value: unknown,
): CreateResearchInput['constraints'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError('constraints must be a JSON object');
  }

  const market = optionalString(value.market, 'constraints.market');
  const priceRange = optionalString(value.priceRange, 'constraints.priceRange');
  const competition = value.competition;
  if (
    competition !== undefined
    && competition !== 'low'
    && competition !== 'medium'
    && competition !== 'high'
    && competition !== 'any'
  ) {
    throw new TypeError(
      'constraints.competition must be low, medium, high, or any',
    );
  }

  const additional = value.additional === undefined
    ? undefined
    : readStringRecord(value.additional, 'constraints.additional');

  return {
    ...(market === undefined ? {} : { market }),
    ...(priceRange === undefined ? {} : { priceRange }),
    ...(competition === undefined ? {} : { competition }),
    ...(additional === undefined ? {} : { additional }),
  };
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a string`);
  }
  return value;
}

function readStringRecord(
  value: unknown,
  field: string,
): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be a JSON object`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new TypeError(`${field} values must be strings`);
    }
    result[key] = item;
  }
  return result;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
