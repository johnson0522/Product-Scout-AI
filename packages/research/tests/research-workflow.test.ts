import { describe, expect, it } from 'vitest';

import {
  assertResearchWorkflowStepTransition,
  assertResearchWorkflowTransition,
  canSkipResearchWorkflowStep,
  canRetryResearchWorkflowStep,
  DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
  getResearchWorkflowExecutionOrder,
  getResearchWorkflowInvocationKey,
  getResearchWorkflowStepReadiness,
  InvalidResearchWorkflowInputError,
  InvalidResearchWorkflowStepTransitionError,
  InvalidResearchWorkflowTransitionError,
  validateResearchWorkflowDefinition,
  validateStartResearchWorkflowInput,
  type ResearchWorkflowDefinition,
} from '../src';

describe('default research workflow definition', () => {
  it('contains the six bounded research steps and their dependencies', () => {
    validateResearchWorkflowDefinition(DEFAULT_RESEARCH_WORKFLOW_DEFINITION);

    expect(DEFAULT_RESEARCH_WORKFLOW_DEFINITION.steps.map((item) => item.id)).toEqual([
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
      'opportunity_analysis',
      'report_generation',
    ]);
    expect(getResearchWorkflowExecutionOrder(DEFAULT_RESEARCH_WORKFLOW_DEFINITION)).toEqual([
      'market_understanding',
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
      'opportunity_analysis',
      'report_generation',
    ]);
    expect(DEFAULT_RESEARCH_WORKFLOW_DEFINITION.steps.every((item) =>
      item.allowSkip === false && item.maxAttempts === 1)).toBe(true);
  });

  it('rejects duplicate, undefined, self-referential, and cyclic dependencies', () => {
    const duplicate: ResearchWorkflowDefinition = {
      id: 'duplicate',
      steps: [
        { id: 'market_understanding', dependsOn: [], allowSkip: false, maxAttempts: 1 },
        { id: 'market_understanding', dependsOn: [], allowSkip: false, maxAttempts: 1 },
      ],
    };
    expect(() => validateResearchWorkflowDefinition(duplicate))
      .toThrow(InvalidResearchWorkflowInputError);

    const undefinedDependency: ResearchWorkflowDefinition = {
      id: 'undefined',
      steps: [{
        id: 'report_generation',
        dependsOn: ['opportunity_analysis'],
        allowSkip: false,
        maxAttempts: 1,
      }],
    };
    expect(() => validateResearchWorkflowDefinition(undefinedDependency))
      .toThrow('depends on undefined step');

    const selfDependency: ResearchWorkflowDefinition = {
      id: 'self',
      steps: [{
        id: 'market_understanding',
        dependsOn: ['market_understanding'],
        allowSkip: false,
        maxAttempts: 1,
      }],
    };
    expect(() => validateResearchWorkflowDefinition(selfDependency))
      .toThrow('cannot depend on itself');

    const cycle: ResearchWorkflowDefinition = {
      id: 'cycle',
      steps: [
        {
          id: 'market_understanding',
          dependsOn: ['report_generation'],
          allowSkip: false,
          maxAttempts: 1,
        },
        {
          id: 'report_generation',
          dependsOn: ['market_understanding'],
          allowSkip: false,
          maxAttempts: 1,
        },
      ],
    };
    expect(() => validateResearchWorkflowDefinition(cycle))
      .toThrow('dependency cycle detected');
  });
});

describe('workflow input validation', () => {
  it('trims required values and preserves optional constraints', () => {
    const input = validateStartResearchWorkflowInput({
      researchRunId: ' run-1 ',
      goal: ' discover a market ',
      constraints: { market: 'US' },
      idempotencyKey: ' request-1 ',
    });
    expect(getResearchWorkflowInvocationKey(input)).toBe('request-1');
    expect(getResearchWorkflowInvocationKey({
      researchRunId: 'run-1',
      goal: 'discover a market',
    })).toBe('run-1');

    expect(input).toEqual({
      researchRunId: 'run-1',
      goal: 'discover a market',
      constraints: { market: 'US' },
      idempotencyKey: 'request-1',
    });
  });

  it.each([
    ['researchRunId', { researchRunId: ' ', goal: 'goal' }],
    ['goal', { researchRunId: 'run-1', goal: ' ' }],
    ['idempotencyKey', { researchRunId: 'run-1', goal: 'goal', idempotencyKey: ' ' }],
  ] as const)('rejects empty %s', (_field, input) => {
    expect(() => validateStartResearchWorkflowInput(input))
      .toThrow(InvalidResearchWorkflowInputError);
  });
});

describe('workflow state transitions', () => {
  it.each([
    ['pending', 'running'],
    ['pending', 'failed'],
    ['pending', 'cancelled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertResearchWorkflowTransition(from, to)).not.toThrow();
  });

  it.each([
    ['pending', 'completed'],
    ['running', 'running'],
    ['completed', 'running'],
    ['failed', 'pending'],
    ['cancelled', 'failed'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertResearchWorkflowTransition(from, to))
      .toThrow(InvalidResearchWorkflowTransitionError);
  });

  it.each([
    ['pending', 'running'],
    ['pending', 'skipped'],
    ['pending', 'cancelled'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'skipped'],
    ['running', 'cancelled'],
    ['failed', 'pending'],
  ] as const)('allows step %s -> %s', (from, to) => {
    expect(() => assertResearchWorkflowStepTransition(from, to)).not.toThrow();
  });

  it('rejects terminal step transitions', () => {
    expect(() => assertResearchWorkflowStepTransition('completed', 'pending'))
      .toThrow(InvalidResearchWorkflowStepTransitionError);
    expect(() => assertResearchWorkflowStepTransition('skipped', 'running'))
      .toThrow(InvalidResearchWorkflowStepTransitionError);
    expect(() => assertResearchWorkflowStepTransition('cancelled', 'pending'))
      .toThrow(InvalidResearchWorkflowStepTransitionError);
  });
});

describe('workflow retry contract', () => {
  const definition = {
    id: 'market_understanding' as const,
    dependsOn: [],
    allowSkip: false,
    maxAttempts: 3,
  };

  it('allows only retryable failed steps below max attempts', () => {
    expect(canRetryResearchWorkflowStep({
      status: 'failed',
      attempt: 1,
      failure: { kind: 'timeout', message: 'timed out', retryable: true },
    }, definition)).toBe(true);
    expect(canRetryResearchWorkflowStep({
      status: 'failed',
      attempt: 3,
      failure: { kind: 'timeout', message: 'timed out', retryable: true },
    }, definition)).toBe(false);
    expect(canRetryResearchWorkflowStep({
      status: 'failed',
      attempt: 1,
      failure: { kind: 'invalid_input', message: 'bad input', retryable: false },
    }, definition)).toBe(false);
    expect(canRetryResearchWorkflowStep({
      status: 'completed',
      attempt: 1,
    }, definition)).toBe(false);
  });
});

describe('workflow dependency and skip contract', () => {
  const definition = {
    id: 'opportunity_analysis' as const,
    dependsOn: [
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
    ] as const,
    allowSkip: false,
    maxAttempts: 1,
  };

  it('is ready only after every dependency completed', () => {
    expect(getResearchWorkflowStepReadiness(definition, [
      { stepId: 'pain_point_research', status: 'completed' },
      { stepId: 'competitor_research', status: 'completed' },
      { stepId: 'market_signal_research', status: 'completed' },
    ])).toBe('ready');
    expect(getResearchWorkflowStepReadiness(definition, [
      { stepId: 'pain_point_research', status: 'completed' },
      { stepId: 'competitor_research', status: 'running' },
    ])).toBe('blocked');
  });

  it('distinguishes terminal dependency failure from an incomplete dependency', () => {
    expect(getResearchWorkflowStepReadiness(definition, [
      { stepId: 'pain_point_research', status: 'completed' },
      { stepId: 'competitor_research', status: 'failed' },
      { stepId: 'market_signal_research', status: 'completed' },
    ])).toBe('dependency_failed');
  });

  it('does not allow default core steps to be skipped', () => {
    expect(canSkipResearchWorkflowStep({ status: 'pending' }, definition)).toBe(false);
    expect(canSkipResearchWorkflowStep(
      { status: 'pending' },
      { ...definition, allowSkip: true },
    )).toBe(true);
    expect(canSkipResearchWorkflowStep(
      { status: 'running' },
      { ...definition, allowSkip: true },
    )).toBe(false);
  });
});
