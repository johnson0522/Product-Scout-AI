CREATE TABLE IF NOT EXISTS "evidence_store" (
	"id" text PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"source_title" text,
	"source_domain" text,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
