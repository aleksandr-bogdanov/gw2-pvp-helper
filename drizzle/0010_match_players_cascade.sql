ALTER TABLE "match_players" DROP CONSTRAINT IF EXISTS "match_players_match_id_matches_match_id_fk";
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("match_id") ON DELETE CASCADE ON UPDATE NO ACTION;
