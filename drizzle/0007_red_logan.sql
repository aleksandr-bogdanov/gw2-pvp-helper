ALTER TABLE "match_players" ADD COLUMN "is_user" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "comment" text;