ALTER TABLE "research_runs"
  ADD COLUMN IF NOT EXISTS "agent_session_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "research_runs"
  ADD COLUMN IF NOT EXISTS "runtime_metadata" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_run_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"sequence_number" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_events_run_event_idx" ON "product_events" ("research_run_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_events_run_sequence_idx" ON "product_events" ("research_run_id","sequence_number");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_events" ADD CONSTRAINT "product_events_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
