DO $$ BEGIN
 CREATE TYPE "research_finding_type" AS ENUM('opportunity', 'risk', 'insight');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claim_evidence_refs" (
	"claim_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "claim_evidence_refs_claim_id_evidence_id_pk" PRIMARY KEY("claim_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"research_run_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_finding_claims" (
	"finding_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "research_finding_claims_finding_id_claim_id_pk" PRIMARY KEY("finding_id","claim_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "research_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"research_run_id" uuid NOT NULL,
	"type" "research_finding_type" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "claim_evidence_refs_claim_position_idx" ON "claim_evidence_refs" ("claim_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "research_finding_claims_finding_position_idx" ON "research_finding_claims" ("finding_id","position");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_evidence_refs" ADD CONSTRAINT "claim_evidence_refs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_evidence_refs" ADD CONSTRAINT "claim_evidence_refs_evidence_id_evidence_store_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "evidence_store"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_finding_claims" ADD CONSTRAINT "research_finding_claims_finding_id_research_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "research_findings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_finding_claims" ADD CONSTRAINT "research_finding_claims_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "research_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
