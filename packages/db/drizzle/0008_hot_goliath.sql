CREATE TABLE IF NOT EXISTS "research_quality_snapshots" (
	"finding_id" text NOT NULL,
	"workflow_invocation_key" text NOT NULL,
	"rules_version" text NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"inputs" jsonb NOT NULL,
	"assessment" jsonb NOT NULL,
	CONSTRAINT "research_quality_snapshots_finding_id_workflow_invocation_key_rules_version_pk" PRIMARY KEY("finding_id","workflow_invocation_key","rules_version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_quality_snapshots" ADD CONSTRAINT "research_quality_snapshots_finding_id_research_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "research_findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
