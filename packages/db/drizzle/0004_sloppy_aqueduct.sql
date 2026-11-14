CREATE TABLE IF NOT EXISTS "evidence_acquisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_run_id" uuid NOT NULL,
	"evidence_id" text NOT NULL,
	"workflow_invocation_key" text NOT NULL,
	"step_id" "research_step_type" NOT NULL,
	"source_fingerprint" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evidence_acquisitions_scope_idx" ON "evidence_acquisitions" ("research_run_id","workflow_invocation_key","step_id","source_fingerprint");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_acquisitions" ADD CONSTRAINT "evidence_acquisitions_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_acquisitions" ADD CONSTRAINT "evidence_acquisitions_evidence_id_evidence_store_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "evidence_store"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
