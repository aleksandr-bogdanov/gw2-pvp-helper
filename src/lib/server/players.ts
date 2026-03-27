import { db } from './db/index.js';
import { players, matchPlayers, matches } from './db/schema.js';
import { eq, sql } from 'drizzle-orm';

export interface PlayerHistory {
	character_name: string;
	profession: string | null;
	spec: string | null;
	role: string | null;
	spec_source: string | null;
	times_seen: number;
	wins_against: number;
	losses_against: number;
	last_seen_at: Date | null;
	avg_skill: number | null;
	avg_friendly: number | null;
	tag: string | null;
}

/**
 * Look up player history for a list of character names.
 * Stats + ratings computed from match_players + matches (always consistent).
 * Metadata (tag, nickname, comment) comes from the players table.
 */
export async function lookupPlayers(names: string[], userId: number | null): Promise<Map<string, PlayerHistory>> {
	const validNames = names.filter((n) => n && !n.startsWith('Unknown Player'));
	if (validNames.length === 0 || !userId) return new Map();

	const rows = await db.execute<{
		character_name: string;
		profession: string | null;
		spec: string | null;
		role: string | null;
		times_seen: number;
		wins_against: number;
		losses_against: number;
		last_seen_at: Date | null;
		avg_skill: number | null;
		avg_friendly: number | null;
		tag: string | null;
	}>(sql`
		WITH stats AS (
			SELECT
				mp.character_name,
				COUNT(DISTINCT mp.match_id)::int AS times_seen,
				COUNT(DISTINCT CASE
					WHEN m.result = 'win' AND mp.team != m.user_team_color THEN m.match_id
				END)::int AS wins_against,
				COUNT(DISTINCT CASE
					WHEN m.result = 'loss' AND mp.team != m.user_team_color THEN m.match_id
				END)::int AS losses_against,
				MAX(m.timestamp) AS last_seen_at,
				ROUND(AVG(mp.rating_skill)::numeric, 1) AS avg_skill,
				ROUND(AVG(mp.rating_friendly)::numeric, 1) AS avg_friendly
			FROM match_players mp
			JOIN matches m ON mp.match_id = m.match_id
			WHERE mp.character_name IN (${sql.join(validNames.map(n => sql`${n}`), sql`, `)})
			  AND mp.is_user = false
			  AND m.user_id = ${userId}
			GROUP BY mp.character_name
		),
		latest AS (
			SELECT DISTINCT ON (mp.character_name)
				mp.character_name, mp.profession, mp.spec, mp.role
			FROM match_players mp
			JOIN matches m ON mp.match_id = m.match_id
			WHERE mp.character_name IN (${sql.join(validNames.map(n => sql`${n}`), sql`, `)})
			  AND mp.is_user = false
			  AND m.user_id = ${userId}
			ORDER BY mp.character_name, m.timestamp DESC
		)
		SELECT
			s.character_name,
			l.profession,
			l.spec,
			l.role,
			s.times_seen,
			s.wins_against,
			s.losses_against,
			s.last_seen_at,
			s.avg_skill,
			s.avg_friendly,
			p.tag
		FROM stats s
		JOIN latest l ON s.character_name = l.character_name
		LEFT JOIN players p ON s.character_name = p.character_name
			AND p.user_id = ${userId}
	`);

	const map = new Map<string, PlayerHistory>();
	for (const row of rows) {
		map.set(row.character_name, {
			character_name: row.character_name,
			profession: row.profession,
			spec: row.spec,
			role: row.role,
			spec_source: null,
			times_seen: row.times_seen,
			wins_against: row.wins_against,
			losses_against: row.losses_against,
			last_seen_at: row.last_seen_at,
			avg_skill: row.avg_skill ? Number(row.avg_skill) : null,
			avg_friendly: row.avg_friendly ? Number(row.avg_friendly) : null,
			tag: row.tag
		});
	}
	return map;
}
