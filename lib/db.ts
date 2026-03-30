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

// ========== PLAYERS ==========

export async function registerPlayer(
  email: string,
  nickname: string,
  avatar: { icon: string; color: string },
): Promise<{ id: number; email: string; nickname: string; avatar: object } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    // Try to find existing player by email
    const existing = await findPlayerByEmail(email);
    if (existing) {
      // Update nickname/avatar and last_seen
      const { data, error } = await client
        .from('players')
        .update({ nickname, avatar, last_seen: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) {
        console.error('DB updatePlayer error:', error.message);
        return existing;
      }
      return data;
    }

    // Create new player
    const { data, error } = await client
      .from('players')
      .insert({ email, nickname, avatar })
      .select()
      .single();

    if (error) {
      console.error('DB registerPlayer error:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('DB registerPlayer exception:', (e as Error).message);
    return null;
  }
}

export async function findPlayerByEmail(
  email: string,
): Promise<{ id: number; email: string; nickname: string; avatar: object; games_played: number; total_score: number; best_streak: number } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('players')
      .select('*')
      .eq('email', email)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function updatePlayerStats(
  playerId: number,
  score: number,
  streak: number,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const player = await client
      .from('players')
      .select('games_played, total_score, best_streak')
      .eq('id', playerId)
      .single();

    if (player.error || !player.data) return;

    await client
      .from('players')
      .update({
        games_played: player.data.games_played + 1,
        total_score: player.data.total_score + score,
        best_streak: Math.max(player.data.best_streak, streak),
        last_seen: new Date().toISOString(),
      })
      .eq('id', playerId);
  } catch (e) {
    console.error('DB updatePlayerStats exception:', (e as Error).message);
  }
}

// ========== LEADERBOARD ==========

export async function getLeaderboard(
  period: 'week' | 'month' | 'all' = 'all',
  limit = 50,
): Promise<Array<{ id: number; nickname: string; avatar: object; games_played: number; total_score: number; best_streak: number }>> {
  const client = getClient();
  if (!client) return [];

  try {
    let query = client
      .from('players')
      .select('id, nickname, avatar, games_played, total_score, best_streak, created_at')
      .gt('games_played', 0)
      .order('total_score', { ascending: false })
      .limit(limit);

    if (period === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('last_seen', weekAgo);
    } else if (period === 'month') {
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('last_seen', monthAgo);
    }

    const { data, error } = await query;
    if (error) {
      console.error('DB getLeaderboard error:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('DB getLeaderboard exception:', (e as Error).message);
    return [];
  }
}

// ========== PLAYER HISTORY ==========

export async function getPlayerGames(
  playerId: number,
  limit = 50,
): Promise<Array<{ id: number; quiz_title: string; pin: string; player_count: number; question_count: number; rankings: unknown; ended_at: string; player_score: number | null; player_rank: number | null }>> {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('game_history')
      .select('*')
      .order('ended_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('DB getPlayerGames error:', error.message);
      return [];
    }

    // Filter games where this player participated and extract their score/rank
    const results: Array<{ id: number; quiz_title: string; pin: string; player_count: number; question_count: number; rankings: unknown; ended_at: string; player_score: number | null; player_rank: number | null }> = [];
    for (const game of data || []) {
      const rankings = (game.rankings || []) as Array<{ nickname: string; score: number; rank: number; playerId?: number }>;
      const entry = rankings.find((r: { playerId?: number }) => r.playerId === playerId);
      if (entry) {
        results.push({
          ...game,
          player_score: entry.score,
          player_rank: entry.rank,
        });
      }
    }
    return results;
  } catch (e) {
    console.error('DB getPlayerGames exception:', (e as Error).message);
    return [];
  }
}

export async function getPlayerProfile(
  playerId: number,
): Promise<{ player: object; achievements: Array<{ achievement_id: string; unlocked_at: string; title: string; description: string; icon: string; category: string }> } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const { data: player, error: pErr } = await client
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (pErr || !player) return null;

    const { data: achievements, error: aErr } = await client
      .from('player_achievements')
      .select('achievement_id, unlocked_at, achievements(title, description, icon, category)')
      .eq('player_id', playerId)
      .order('unlocked_at', { ascending: false });

    const flatAchievements = (achievements || []).map((a: Record<string, unknown>) => {
      const ach = a.achievements as Record<string, string> | null;
      return {
        achievement_id: a.achievement_id as string,
        unlocked_at: a.unlocked_at as string,
        title: ach?.title || '',
        description: ach?.description || '',
        icon: ach?.icon || '',
        category: ach?.category || '',
      };
    });

    if (aErr) console.error('DB achievements error:', aErr.message);

    return { player, achievements: flatAchievements };
  } catch (e) {
    console.error('DB getPlayerProfile exception:', (e as Error).message);
    return null;
  }
}

// ========== ACHIEVEMENTS ==========

export async function getAchievements(): Promise<Array<{ id: string; title: string; description: string; icon: string; category: string }>> {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('achievements')
      .select('*')
      .order('category');

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function awardAchievement(playerId: number, achievementId: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from('player_achievements')
      .upsert(
        { player_id: playerId, achievement_id: achievementId },
        { onConflict: 'player_id,achievement_id' },
      );

    if (error) {
      console.error('DB awardAchievement error:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function getPlayerAchievementIds(playerId: number): Promise<string[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('player_achievements')
      .select('achievement_id')
      .eq('player_id', playerId);

    if (error) return [];
    return (data || []).map((a: { achievement_id: string }) => a.achievement_id);
  } catch {
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
