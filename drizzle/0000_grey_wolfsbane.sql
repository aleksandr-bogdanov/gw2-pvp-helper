CREATE TABLE "match_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" uuid,
	"character_name" text,
	"team" text,
	"profession" text,
	"spec" text,
	"role" text
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"match_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_profile_id" integer,
	"user_team_color" text,
	"map" text,
	"result" text,
	"notes" text,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "players" (
	"character_name" text PRIMARY KEY NOT NULL,
	"profession" text,
	"spec" text,
	"role" text,
	"spec_source" text,
	"times_seen" integer DEFAULT 0,
	"wins_against" integer DEFAULT 0,
	"losses_against" integer DEFAULT 0,
	"last_seen_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_name" text NOT NULL,
	"profession" text NOT NULL,
	"spec" text NOT NULL,
	"build_label" text,
	"role" text NOT NULL,
	"weapons_main" text,
	"weapons_swap" text,
	"profile_prompt" text,
	"is_active" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("match_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_profile_id_user_profiles_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE no action ON UPDATE no action;