import type { Finding, Research, ResearchResult } from '@product-scout/domain';

export interface ResearchService {
  runMarketResearch(params: MarketResearchParams): Promise<Research>;
  runCompetitorResearch(params: CompetitorResearchParams): Promise<Research>;
  analyzeOpportunity(params: OpportunityAnalysisParams): Promise<Research>;
}

export interface MarketResearchParams {
  projectId: string;
  topic: string;
  targetAudience?: string;
}

export interface CompetitorResearchParams {
  projectId: string;
  competitors: string[];
  metrics?: string[];
}

export interface OpportunityAnalysisParams {
  projectId: string;
  marketData: unknown;
  competitorData: unknown;
}

export type { Research, ResearchResult, Finding };
