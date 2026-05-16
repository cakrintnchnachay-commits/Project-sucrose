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
