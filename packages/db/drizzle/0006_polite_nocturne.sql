CREATE TABLE IF NOT EXISTS "research_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"research_run_id" uuid NOT NULL,
	"title" text NOT NULL,
	"executive_summary" text NOT NULL,
	"sections" jsonb NOT NULL,
	"limitations" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_reports_research_run_idx" ON "research_reports" ("research_run_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
