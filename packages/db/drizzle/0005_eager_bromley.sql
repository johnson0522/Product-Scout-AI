ALTER TABLE "opportunity_scores" ADD COLUMN "reasoning" jsonb DEFAULT '{"pain":"Legacy score did not record an explanation.","willingnessToPay":"Legacy score did not record an explanation.","frequency":"Legacy score did not record an explanation.","market":"Legacy score did not record an explanation.","competition":"Legacy score did not record an explanation.","acquisition":"Legacy score did not record an explanation.","feasibility":"Legacy score did not record an explanation."}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "opportunity_scores" ALTER COLUMN "reasoning" DROP DEFAULT;
