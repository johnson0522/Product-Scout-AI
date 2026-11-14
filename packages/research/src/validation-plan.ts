import { createHash } from 'node:crypto';

import {
  createValidationPlan,
  type Opportunity,
  type ResearchReport,
  type ResearchRunId,
  type ValidationPlan,
  type ValidationPlanDay,
  type ValidationPlanDayNumber,
} from '@product-scout/domain';

export interface ValidationPlanGenerationInput {
  readonly researchRunId: ResearchRunId;
  readonly goal: string;
  readonly invocationKey: string;
  readonly report: ResearchReport;
  readonly opportunities: readonly Opportunity[];
}

export interface ValidationPlanDraft {
  readonly days: readonly ValidationPlanDay[];
}

export interface ValidationPlanProvider {
  createPlan(input: ValidationPlanGenerationInput): Promise<ValidationPlanDraft>;
}

export interface ValidationPlanStore {
  getById(id: ValidationPlan['id']): Promise<ValidationPlan | null>;
  ensure(plan: ValidationPlan): Promise<ValidationPlan>;
}

export class InvalidValidationPlanDraftError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidValidationPlanDraftError';
  }
}

export class ValidationPlanService {
  public constructor(
    private readonly provider: ValidationPlanProvider,
    private readonly store: ValidationPlanStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async generate(input: ValidationPlanGenerationInput): Promise<ValidationPlan> {
    const id = createValidationPlanAggregateId(input.researchRunId, input.invocationKey);
    const existing = await this.store.getById(id);
    if (existing !== null) return existing;
    const draft = validateValidationPlanDraft(await this.provider.createPlan(input));
    return this.store.ensure(createValidationPlan({
      id,
      researchRunId: input.researchRunId,
      days: draft.days,
      createdAt: this.now(),
    }));
  }
}

export function createValidationPlanAggregateId(
  researchRunId: string,
  invocationKey: string,
): string {
  const identity = [
    nonEmpty(researchRunId, 'researchRunId'),
    nonEmpty(invocationKey, 'invocationKey'),
    'validation-plan',
  ].join('\u0000');
  const hex = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function parseValidationPlanDraft(value: unknown): ValidationPlanDraft {
  const root = exactRecord(value, ['days'], 'validation plan');
  return {
    days: unknownArray(root.days, 'days').map((day, index) => parseDay(day, index)),
  };
}

export function validateValidationPlanDraft(draft: ValidationPlanDraft): ValidationPlanDraft & {
  readonly days: ValidationPlan['days'];
} {
  if (draft.days.length !== 7) {
    throw new InvalidValidationPlanDraftError('days must contain exactly seven entries');
  }
  const days: ValidationPlan['days'] = [
    validateDay(draft.days[0], 1),
    validateDay(draft.days[1], 2),
    validateDay(draft.days[2], 3),
    validateDay(draft.days[3], 4),
    validateDay(draft.days[4], 5),
    validateDay(draft.days[5], 6),
    validateDay(draft.days[6], 7),
  ];
  return { days };
}

function parseDay(value: unknown, index: number): ValidationPlanDay {
  const field = `days[${index}]`;
  const record = exactRecord(
    value,
    ['day', 'objective', 'activities', 'successCriteria'],
    field,
  );
  return {
    day: unknownDayNumber(record.day, `${field}.day`),
    objective: unknownString(record.objective, `${field}.objective`),
    activities: stringArray(record.activities, `${field}.activities`),
    successCriteria: stringArray(record.successCriteria, `${field}.successCriteria`),
  };
}

function validateDay(
  value: ValidationPlanDay | undefined,
  expected: ValidationPlanDayNumber,
): ValidationPlanDay {
  if (value === undefined || value.day !== expected) {
    throw new InvalidValidationPlanDraftError(
      `days must be ordered from 1 to 7; expected day ${expected}`,
    );
  }
  if (value.activities.length === 0 || value.successCriteria.length === 0) {
    throw new InvalidValidationPlanDraftError(
      `day ${expected} requires activities and successCriteria`,
    );
  }
  return {
    day: expected,
    objective: nonEmpty(value.objective, `day ${expected} objective`),
    activities: value.activities.map((item, index) =>
      nonEmpty(item, `day ${expected} activities[${index}]`)),
    successCriteria: value.successCriteria.map((item, index) =>
      nonEmpty(item, `day ${expected} successCriteria[${index}]`)),
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new InvalidValidationPlanDraftError(`${field} must be an object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new InvalidValidationPlanDraftError(`${field} contains unknown field: ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new InvalidValidationPlanDraftError(`${field} is missing required field: ${key}`);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidValidationPlanDraftError(`${field} must be an array`);
  return value;
}

function stringArray(value: unknown, field: string): readonly string[] {
  return unknownArray(value, field).map((item, index) =>
    unknownString(item, `${field}[${index}]`));
}

function unknownString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new InvalidValidationPlanDraftError(`${field} must be a string`);
  return nonEmpty(value, field);
}

function unknownDayNumber(value: unknown, field: string): ValidationPlanDayNumber {
  if (value === 1 || value === 2 || value === 3 || value === 4
    || value === 5 || value === 6 || value === 7) return value;
  throw new InvalidValidationPlanDraftError(`${field} must be an integer from 1 to 7`);
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidValidationPlanDraftError(`${field} must be a non-empty string`);
  }
  return value.trim();
}
