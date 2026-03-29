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
