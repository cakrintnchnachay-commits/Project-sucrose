-- Project Sucrose — Supabase RLS setup
-- Run this once in the Supabase SQL editor (project dashboard → SQL Editor)
-- It grants the anonymous key full access to the three v2 write tables.

-- games_v2
ALTER TABLE games_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON games_v2;
CREATE POLICY "anon_all" ON games_v2
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- player_scores_v2
ALTER TABLE player_scores_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON player_scores_v2;
CREATE POLICY "anon_all" ON player_scores_v2
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- enemy_picks
ALTER TABLE enemy_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON enemy_picks;
CREATE POLICY "anon_all" ON enemy_picks
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- Match linking: games_v2 needs a nullable match_id so a logged game
-- can be attached to a match/session. Safe to run repeatedly.
-- If this is NOT run, core game logging still works — only the
-- "assign game to match" action will fail with a graceful toast.
ALTER TABLE games_v2 ADD COLUMN IF NOT EXISTS match_id uuid;

-- games_v2: team/enemy gold totals + enemy role/gold snapshot.
ALTER TABLE games_v2 ADD COLUMN IF NOT EXISTS team_total_gold  integer;
ALTER TABLE games_v2 ADD COLUMN IF NOT EXISTS enemy_total_gold integer;
ALTER TABLE games_v2 ADD COLUMN IF NOT EXISTS enemy_roles      jsonb;

-- player_scores_v2: computed/derived metrics. Each is calculated on save
-- (see saveGame / saveEditGame) and stored so history & detail views can
-- display them without recomputing. Safe to run repeatedly.
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS gold_per_min          numeric; -- gold / duration_min
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS opp_gold              integer; -- enemy player gold in same role
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS opp_gold_per_min      numeric; -- opp_gold / duration_min
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS min_per_death         numeric; -- duration_min / max(deaths,1)
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS kill_contribution_pct numeric; -- (kills+assists) / team_total_kills * 100
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS kda                   numeric; -- (kills+assists) / max(deaths,1)
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS dmg_dealt_raw         integer; -- raw damage dealt from scanner
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS dmg_taken_raw         integer; -- raw damage taken from scanner
ALTER TABLE player_scores_v2 ADD COLUMN IF NOT EXISTS dmg_per_dmg_taken     numeric; -- dmg_dealt_raw / max(dmg_taken_raw,1)

-- players: roster sync + role persistence.
-- Without an anon RLS policy, every add/edit/delete of a player is silently
-- rejected (new players never persist, never appear on other devices).
-- Without a `status` column, the three-way roster status (Starter /
-- Substitute / Inactive) cannot be saved and gets reset on reload.
ALTER TABLE players ADD COLUMN IF NOT EXISTS status text;

-- players.aliases: alternate in-game names the scanner maps to this player.
-- A jsonb array of lower-cased strings, e.g. ["smurfname","scrim_tag"]. Without it,
-- a player who queues under a different IGN is mis-identified every scan and the coach
-- must re-correct it each game. Safe to run repeatedly; defaults to an empty array.
ALTER TABLE players ADD COLUMN IF NOT EXISTS aliases jsonb DEFAULT '[]'::jsonb;

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON players;
CREATE POLICY "anon_all" ON players
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- Backfill status for existing rows from the legacy `active` boolean.
UPDATE players SET status = CASE WHEN active THEN 'Starter' ELSE 'Inactive' END
  WHERE status IS NULL;

-- players.id must carry a unique constraint so upsert(onConflict:'id') resolves.
-- Without it, every add/edit fails with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". Idempotent: only adds the
-- constraint when no single-column primary-key/unique constraint on `id` exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.players'::regclass
      AND c.contype IN ('p','u')
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'id'
  ) THEN
    ALTER TABLE public.players ADD CONSTRAINT players_id_key UNIQUE (id);
  END IF;
END $$;
