const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

function getClient() {
  if (!supabase && supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

function isEnabled() {
  return !!(supabaseUrl && supabaseKey);
}

// ========== QUIZZES ==========

async function saveQuiz(id, title, questions, options) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('quizzes')
      .upsert({
        id,
        title,
        questions,
        shuffle_questions: options.shuffleQuestions || false,
        shuffle_choices: options.shuffleChoices || false,
        created_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select();

    if (error) { console.error('DB saveQuiz error:', error.message); return null; }
    return data;
  } catch (e) {
    console.error('DB saveQuiz exception:', e.message);
    return null;
  }
}

async function listQuizzes(limit = 50) {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('quizzes')
      .select('id, title, questions, shuffle_questions, shuffle_choices, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) { console.error('DB listQuizzes error:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('DB listQuizzes exception:', e.message);
    return [];
  }
}

async function loadQuiz(id) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('quizzes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function deleteQuiz(id) {
  const client = getClient();
  if (!client) return false;

  try {
    const { error } = await client.from('quizzes').delete().eq('id', id);
    return !error;
  } catch (e) {
    return false;
  }
}

// ========== GAME HISTORY ==========

async function saveGameHistory(gameData) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('game_history')
      .insert({
        quiz_title: gameData.quizTitle,
        quiz_id: gameData.quizId,
        pin: gameData.pin,
        player_count: gameData.playerCount,
        question_count: gameData.questionCount,
        rankings: gameData.rankings,
        started_at: gameData.startedAt,
        ended_at: new Date().toISOString()
      })
      .select();

    if (error) { console.error('DB saveGameHistory error:', error.message); return null; }
    return data;
  } catch (e) {
    console.error('DB saveGameHistory exception:', e.message);
    return null;
  }
}

async function getGameHistory(limit = 50) {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('game_history')
      .select('*')
      .order('ended_at', { ascending: false })
      .limit(limit);

    if (error) { console.error('DB getGameHistory error:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('DB getGameHistory exception:', e.message);
    return [];
  }
}

// ========== INIT (create tables if needed) ==========

async function initTables() {
  const client = getClient();
  if (!client) {
    console.log('  [DB] Supabase non configure - mode memoire uniquement');
    return;
  }

  try {
    // Test connection by querying quizzes table
    const { error } = await client.from('quizzes').select('id').limit(1);
    if (error && error.code === '42P01') {
      console.log('  [DB] Tables non trouvees. Executez le script SQL dans Supabase Dashboard :');
      console.log('  [DB] Voir le fichier setup-db.sql');
      return;
    }
    if (error) {
      console.log(`  [DB] Erreur connexion Supabase: ${error.message}`);
      return;
    }
    console.log('  [DB] Supabase connecte');
  } catch (e) {
    console.log(`  [DB] Erreur Supabase: ${e.message}`);
  }
}

module.exports = {
  isEnabled,
  saveQuiz,
  listQuizzes,
  loadQuiz,
  deleteQuiz,
  saveGameHistory,
  getGameHistory,
  initTables
};
