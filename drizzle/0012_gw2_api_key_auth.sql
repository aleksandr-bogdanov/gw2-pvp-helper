-- Migration 0012: Switch from invite-code/password auth to GW2 API key auth
-- Also adds indexes on frequently queried FK columns

-- Add new GW2 auth columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gw2_account_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gw2_api_key_encrypted" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_gw2_account_id_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_gw2_account_id_unique" UNIQUE ("gw2_account_id");
  END IF;
END $$;
--> statement-breakpoint

-- Drop deprecated auth columns and table
ALTER TABLE "users" DROP COLUMN IF EXISTS "invite_code_used";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
--> statement-breakpoint
DROP TABLE IF EXISTS "used_invite_codes";
--> statement-breakpoint

-- Add indexes on FK columns for query performance
CREATE INDEX IF NOT EXISTS "match_players_match_id_idx" ON "match_players" ("match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_user_id_idx" ON "matches" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_screenshot_hash_idx" ON "matches" ("screenshot_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profiles_user_id_idx" ON "user_profiles" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_samples_user_id_idx" ON "training_samples" ("user_id");
