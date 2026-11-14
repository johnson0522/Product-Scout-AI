import { createHash } from 'node:crypto';

import {
  createResearchReport,
  type Finding,
  type Opportunity,
  type ResearchReport,
  type ResearchReportSection,
  type ResearchRunId,
} from '@product-scout/domain';

export interface ResearchReportPlanInput {
  readonly researchRunId: ResearchRunId;
  readonly goal: string;
  readonly invocationKey: string;
  readonly findings: readonly Finding[];
  readonly opportunities: readonly Opportunity[];
}

export interface ResearchReportSectionDraft {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly findingIds: readonly Finding['id'][];
  readonly opportunityIds: readonly Opportunity['id'][];
}

export interface ResearchReportPlan {
  readonly title: string;
  readonly executiveSummary: string;
  readonly sections: readonly ResearchReportSectionDraft[];
  readonly limitations: readonly string[];
}

export interface ResearchReportPlanProvider {
  createPlan(input: ResearchReportPlanInput): Promise<ResearchReportPlan>;
}

export interface ResearchReportStore {
  getById(id: ResearchReport['id']): Promise<ResearchReport | null>;
  ensure(report: ResearchReport): Promise<ResearchReport>;
}

export class InvalidResearchReportPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidResearchReportPlanError';
  }
}

export class ResearchReportService {
  public constructor(
    private readonly provider: ResearchReportPlanProvider,
    private readonly store: ResearchReportStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async generate(input: ResearchReportPlanInput): Promise<ResearchReport> {
    const id = createResearchReportAggregateId(input.researchRunId, input.invocationKey);
    const existing = await this.store.getById(id);
    if (existing !== null) return existing;
    const plan = validateResearchReportPlan(await this.provider.createPlan(input), input);
    return this.store.ensure(createResearchReport({
      id,
      researchRunId: input.researchRunId,
      title: plan.title,
      executiveSummary: plan.executiveSummary,
      sections: plan.sections,
      limitations: plan.limitations,
      createdAt: this.now(),
    }));
  }
}

export function createResearchReportAggregateId(
  researchRunId: string,
  invocationKey: string,
): string {
  const identity = [
    nonEmpty(researchRunId, 'researchRunId'),
    nonEmpty(invocationKey, 'invocationKey'),
    'research-report',
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

export function parseResearchReportPlan(value: unknown): ResearchReportPlan {
  const root = exactRecord(
    value,
    ['title', 'executiveSummary', 'sections', 'limitations'],
    'research report plan',
  );
  return {
    title: unknownString(root.title, 'title'),
    executiveSummary: unknownString(root.executiveSummary, 'executiveSummary'),
    sections: unknownArray(root.sections, 'sections').map((section, index) =>
      parseSection(section, index)),
    limitations: unknownArray(root.limitations, 'limitations').map((item, index) =>
      unknownString(item, `limitations[${index}]`)),
  };
}

export function validateResearchReportPlan(
  plan: ResearchReportPlan,
  input: ResearchReportPlanInput,
): ResearchReportPlan {
  if (plan.sections.length === 0) {
    throw new InvalidResearchReportPlanError('sections must contain at least one section');
  }
  const findingIds = new Set(input.findings.map((finding) => finding.id));
  const opportunityIds = new Set(input.opportunities.map((opportunity) => opportunity.id));
  const sectionIds = new Set<string>();
  const sections: ResearchReportSection[] = plan.sections.map((section) => {
    const id = nonEmpty(section.id, 'section id');
    if (sectionIds.has(id)) {
      throw new InvalidResearchReportPlanError(`Duplicate section id: ${id}`);
    }
    sectionIds.add(id);
    const sectionFindingIds = unique(section.findingIds, `Section ${id} findingIds`);
    const sectionOpportunityIds = unique(section.opportunityIds, `Section ${id} opportunityIds`);
    if (sectionFindingIds.length === 0 && sectionOpportunityIds.length === 0) {
      throw new InvalidResearchReportPlanError(
        `Section ${id} must reference at least one Finding or Opportunity`,
      );
    }
    for (const findingId of sectionFindingIds) {
      if (!findingIds.has(findingId)) {
        throw new InvalidResearchReportPlanError(
          `Section ${id} references unavailable Finding: ${findingId}`,
        );
      }
    }
    for (const opportunityId of sectionOpportunityIds) {
      if (!opportunityIds.has(opportunityId)) {
        throw new InvalidResearchReportPlanError(
          `Section ${id} references unavailable Opportunity: ${opportunityId}`,
        );
      }
    }
    return {
      id,
      title: nonEmpty(section.title, `Section ${id} title`),
      content: nonEmpty(section.content, `Section ${id} content`),
      findingIds: sectionFindingIds,
      opportunityIds: sectionOpportunityIds,
    };
  });
  return {
    title: nonEmpty(plan.title, 'title'),
    executiveSummary: nonEmpty(plan.executiveSummary, 'executiveSummary'),
    sections,
    limitations: plan.limitations.map((item, index) =>
      nonEmpty(item, `limitations[${index}]`)),
  };
}

function parseSection(value: unknown, index: number): ResearchReportSectionDraft {
  const field = `sections[${index}]`;
  const record = exactRecord(
    value,
    ['id', 'title', 'content', 'findingIds', 'opportunityIds'],
    field,
  );
  return {
    id: unknownString(record.id, `${field}.id`),
    title: unknownString(record.title, `${field}.title`),
    content: unknownString(record.content, `${field}.content`),
    findingIds: stringArray(record.findingIds, `${field}.findingIds`),
    opportunityIds: stringArray(record.opportunityIds, `${field}.opportunityIds`),
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new InvalidResearchReportPlanError(`${field} must be an object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new InvalidResearchReportPlanError(`${field} contains unknown field: ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new InvalidResearchReportPlanError(`${field} is missing required field: ${key}`);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidResearchReportPlanError(`${field} must be an array`);
  return value;
}

function stringArray(value: unknown, field: string): readonly string[] {
  return unknownArray(value, field).map((item, index) =>
    unknownString(item, `${field}[${index}]`));
}

function unknownString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InvalidResearchReportPlanError(`${field} must be a string`);
  }
  return nonEmpty(value, field);
}

function unique(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value) => nonEmpty(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new InvalidResearchReportPlanError(`${field} must not contain duplicates`);
  }
  return normalized;
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidResearchReportPlanError(`${field} must be a non-empty string`);
  }
  return value.trim();
}
