CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"invite_code_used" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"device_info" jsonb,
	"advice_calls_remaining" integer DEFAULT 15 NOT NULL,
	"profile_gens_remaining" integer DEFAULT 3 NOT NULL,
	"byok_api_key_encrypted" text,
	"byok_model_preference" text DEFAULT 'claude-sonnet-4-6',
	"consent_given_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "rating_skill" integer;--> statement-breakpoint
ALTER TABLE "match_players" ADD COLUMN "rating_friendly" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_invite_codes" ADD CONSTRAINT "used_invite_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;