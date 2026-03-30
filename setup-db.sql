-- Alihoot! - Tables Supabase
-- Executez ce script dans le SQL Editor de votre dashboard Supabase

-- Table des quiz sauvegardes
CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  shuffle_questions BOOLEAN DEFAULT FALSE,
  shuffle_choices BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table de l'historique des parties
CREATE TABLE IF NOT EXISTS game_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quiz_title TEXT NOT NULL,
  quiz_id TEXT,
  pin TEXT,
  player_count INTEGER DEFAULT 0,
  question_count INTEGER DEFAULT 0,
  rankings JSONB,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les requetes frequentes
CREATE INDEX IF NOT EXISTS idx_game_history_ended_at ON game_history (ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_quizzes_created_at ON quizzes (created_at DESC);

-- Desactiver RLS pour simplifier (admin-only app)
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- Politique permissive (acces total avec service key)
CREATE POLICY "Allow all for service role" ON quizzes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON game_history FOR ALL USING (true) WITH CHECK (true);

-- Table des joueurs enregistres
CREATE TABLE IF NOT EXISTS players (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  avatar JSONB DEFAULT '{}',
  games_played INTEGER DEFAULT 0,
  total_score INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_email ON players (email);
CREATE INDEX IF NOT EXISTS idx_players_total_score ON players (total_score DESC);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON players FOR ALL USING (true) WITH CHECK (true);

-- Table des achievements
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
);

-- Table de liaison joueur-achievements
CREATE TABLE IF NOT EXISTS player_achievements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_player_achievements_player ON player_achievements (player_id);

ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON achievements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON player_achievements FOR ALL USING (true) WITH CHECK (true);

-- Seed achievements
INSERT INTO achievements (id, title, description, icon, category) VALUES
  ('first_game', 'Premiere partie', 'Jouer ta premiere partie', '🎮', 'general'),
  ('games_5', 'Habitue', 'Jouer 5 parties', '🎯', 'general'),
  ('games_10', 'Veteran', 'Jouer 10 parties', '🏅', 'general'),
  ('games_25', 'Accro', 'Jouer 25 parties', '🔥', 'general'),
  ('streak_3', 'En serie', '3 bonnes reponses consecutives', '⚡', 'streak'),
  ('streak_5', 'Inarretable', '5 bonnes reponses consecutives', '💥', 'streak'),
  ('streak_10', 'Parfait', '10 bonnes reponses consecutives', '🌟', 'streak'),
  ('score_5000', 'Bon score', 'Atteindre 5000 points en une partie', '📈', 'score'),
  ('score_10000', 'Expert', 'Atteindre 10000 points en une partie', '💎', 'score'),
  ('podium_1', 'Premier podium', 'Terminer dans le top 3', '🏆', 'podium'),
  ('podium_3', 'Habitue du podium', 'Terminer 3 fois dans le top 3', '👑', 'podium'),
  ('winner_1', 'Premiere victoire', 'Gagner une partie', '🥇', 'victory'),
  ('winner_5', 'Champion', 'Gagner 5 parties', '🏆', 'victory')
ON CONFLICT (id) DO NOTHING;
