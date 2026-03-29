import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GameHistoryData, Question } from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!supabase && supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

export function isEnabled(): boolean {
  return !!(supabaseUrl && supabaseKey);
}

// ========== QUIZZES ==========

export async function saveQuiz(
  id: string,
  title: string,
  questions: Question[],
  options: { shuffleQuestions: boolean; shuffleChoices: boolean },
) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('quizzes')
      .upsert(
        {
          id,
          title,
          questions,
          shuffle_questions: options.shuffleQuestions || false,
          shuffle_choices: options.shuffleChoices || false,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select();

    if (error) {
      console.error('DB saveQuiz error:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('DB saveQuiz exception:', (e as Error).message);
    return null;
  }
}

export async function listQuizzes(limit = 50) {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('quizzes')
      .select('id, title, questions, shuffle_questions, shuffle_choices, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('DB listQuizzes error:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('DB listQuizzes exception:', (e as Error).message);
    return [];
  }
}

export async function loadQuiz(id: string) {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client.from('quizzes').select('*').eq('id', id).single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function deleteQuiz(id: string) {
  const client = getClient();
  if (!client) return false;

  try {
    const { error } = await client.from('quizzes').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

// ========== GAME HISTORY ==========

export async function saveGameHistory(gameData: GameHistoryData) {
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
        ended_at: new Date().toISOString(),
      })
      .select();

    if (error) {
      console.error('DB saveGameHistory error:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('DB saveGameHistory exception:', (e as Error).message);
    return null;
  }
}

export async function getGameHistory(limit = 50) {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('game_history')
      .select('*')
      .order('ended_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('DB getGameHistory error:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('DB getGameHistory exception:', (e as Error).message);
    return [];
  }
}

// ========== AUTH ==========

export async function verifyToken(token: string): Promise<{ id: string; email: string } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) return null;
    return { id: user.id, email: user.email || '' };
  } catch {
    return null;
  }
}

// ========== INIT (create tables if needed) ==========

export async function initTables() {
  const client = getClient();
  if (!client) {
    console.log('  [DB] Supabase non configure - mode memoire uniquement');
    return;
  }

  try {
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
    console.log(`  [DB] Erreur Supabase: ${(e as Error).message}`);
  }
}
