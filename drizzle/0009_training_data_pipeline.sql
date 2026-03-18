CREATE TABLE "minimap_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"map_id" text NOT NULL,
	"source" text DEFAULT 'static' NOT NULL,
	"screenshot_hash" text,
	"thumbnail_data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"screenshot_hash" text NOT NULL,
	"screenshot_path" text NOT NULL,
	"resolution" text,
	"ui_size" text,
	"device_info" jsonb,
	"scan_result" jsonb,
	"user_corrections" jsonb,
	"confidence_scores" jsonb,
	"anchor_position" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_by_admin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "training_samples_screenshot_hash_unique" UNIQUE("screenshot_hash")
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "advice_raw" text;--> statement-breakpoint
ALTER TABLE "training_samples" ADD CONSTRAINT "training_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;