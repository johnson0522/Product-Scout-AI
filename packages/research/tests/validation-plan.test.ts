import { describe, expect, it } from 'vitest';
import type { ResearchReport, ValidationPlan } from '@product-scout/domain';

import {
  createValidationPlanAggregateId,
  parseValidationPlanDraft,
  ValidationPlanService,
  validateValidationPlanDraft,
} from '../src';

const report = {
  id: '10000000-0000-5000-8000-000000000001',
  researchRunId: 'run-1',
} as ResearchReport;

describe('ValidationPlan application contract', () => {
  it('strictly parses and validates exactly Day 1 through Day 7', () => {
    const value = { days: days() };
    expect(validateValidationPlanDraft(parseValidationPlanDraft(value))).toEqual(value);
    expect(() => parseValidationPlanDraft({ ...value, extra: true })).toThrow('unknown field');
    expect(() => validateValidationPlanDraft({ days: days().slice(0, 6) }))
      .toThrow('exactly seven');
    expect(() => validateValidationPlanDraft({
      days: [{ ...days()[0], day: 2 }, ...days().slice(1)],
    })).toThrow('expected day 1');
    expect(() => validateValidationPlanDraft({
      days: [{ ...days()[0], successCriteria: [] }, ...days().slice(1)],
    })).toThrow('requires activities and successCriteria');
  });

  it('generates a deterministic persisted ValidationPlan', async () => {
    const stored = new Map<string, ValidationPlan>();
    const service = new ValidationPlanService(
      { async createPlan() { return { days: days() }; } },
      {
        async getById(id) { return stored.get(id) ?? null; },
        async ensure(plan) {
          stored.set(plan.id, plan);
          return plan;
        },
      },
      () => new Date('2026-11-14T01:00:00.000Z'),
    );
    const plan = await service.generate({
      researchRunId: 'run-1',
      goal: 'Research recurring work',
      invocationKey: 'invocation-1',
      report,
      opportunities: [],
    });
    expect(plan.id).toBe(createValidationPlanAggregateId('run-1', 'invocation-1'));
    expect(stored.get(plan.id)).toEqual(plan);
  });

  it('separates deterministic identity by run and invocation', () => {
    const id = createValidationPlanAggregateId('run-1', 'invocation-1');
    expect(createValidationPlanAggregateId('run-1', 'invocation-1')).toBe(id);
    expect(createValidationPlanAggregateId('run-1', 'invocation-2')).not.toBe(id);
  });
});

function days(): ValidationPlan['days'] {
  return [day(1), day(2), day(3), day(4), day(5), day(6), day(7)];
}

function day(value: 1 | 2 | 3 | 4 | 5 | 6 | 7) {
  return {
    day: value,
    objective: `Validate assumption ${value}`,
    activities: [`Run activity ${value}`],
    successCriteria: [`Meet criterion ${value}`],
  };
}
