-- Add password_hash to users table for proper authentication
ALTER TABLE "users" ADD COLUMN "password_hash" text;

-- Restructure players table for per-user data isolation
-- Step 1: Drop the primary key constraint on character_name
ALTER TABLE "players" DROP CONSTRAINT "players_pkey";

-- Step 2: Add id serial PK and user_id FK
ALTER TABLE "players" ADD COLUMN "id" serial;
ALTER TABLE "players" ADD COLUMN "user_id" integer REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "players" ADD PRIMARY KEY ("id");

-- Step 3: Add unique constraint for (character_name, user_id)
CREATE UNIQUE INDEX "players_character_user_unique" ON "players" ("character_name", "user_id") WHERE "user_id" IS NOT NULL;

-- Step 4: Add admin impersonation cookie support (stored in sessions table)
ALTER TABLE "sessions" ADD COLUMN "impersonating_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
