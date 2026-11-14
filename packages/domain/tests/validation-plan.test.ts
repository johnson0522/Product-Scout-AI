import { describe, expect, it } from 'vitest';

import {
  createValidationPlan,
  InvalidValidationPlanError,
  type ValidationPlan,
} from '../src';

describe('createValidationPlan', () => {
  it('creates exactly seven ordered days and copies the timestamp', () => {
    const createdAt = new Date('2026-11-14T00:00:00.000Z');
    const plan = createValidationPlan({
      id: 'plan-1',
      researchRunId: 'run-1',
      days: days(),
      createdAt,
    });
    expect(plan.days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plan.createdAt).not.toBe(createdAt);
  });

  it('rejects out-of-order days and empty activities or criteria', () => {
    const ordered = days();
    expect(() => createValidationPlan({
      id: 'plan-1',
      researchRunId: 'run-1',
      days: [{ ...ordered[0], day: 2 }, ...ordered.slice(1)] as ValidationPlan['days'],
      createdAt: new Date(),
    })).toThrow('expected day 1');
    expect(() => createValidationPlan({
      id: 'plan-1',
      researchRunId: 'run-1',
      days: [{ ...ordered[0], activities: [] }, ...ordered.slice(1)] as ValidationPlan['days'],
      createdAt: new Date(),
    })).toThrow(InvalidValidationPlanError);
  });
});

function days(): ValidationPlan['days'] {
  return [
    day(1), day(2), day(3), day(4), day(5), day(6), day(7),
  ];
}

function day(value: 1 | 2 | 3 | 4 | 5 | 6 | 7) {
  return {
    day: value,
    objective: `Validate assumption ${value}`,
    activities: [`Run activity ${value}`],
    successCriteria: [`Meet criterion ${value}`],
  };
}
