import Redis from 'ioredis';

let client: Redis | null = null;

export function getClient(): Redis | null {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
    });

    client.on('error', (err) => {
      console.error('[redis] Connection error:', err.message);
    });

    client.on('connect', () => {
      console.log('[redis] Connected');
    });

    return client;
  } catch (e) {
    console.error('[redis] Failed to initialize:', e);
    return null;
  }
}

export function isAvailable(): boolean {
  return client !== null && client.status === 'ready';
}

// Quiz cache (persists across restarts)
const QUIZ_PREFIX = 'alihoot:quiz:';
const QUIZ_LIST_KEY = 'alihoot:quiz_ids';
const QUIZ_TTL = 86400; // 24 hours

export async function cacheQuiz(id: string, quiz: unknown): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(QUIZ_PREFIX + id, JSON.stringify(quiz), 'EX', QUIZ_TTL);
    await redis.sadd(QUIZ_LIST_KEY, id);
  } catch (e) {
    console.error('[redis] cacheQuiz error:', e);
  }
}

export async function getCachedQuiz(id: string): Promise<unknown | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    const data = await redis.get(QUIZ_PREFIX + id);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('[redis] getCachedQuiz error:', e);
    return null;
  }
}

export async function deleteCachedQuiz(id: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(QUIZ_PREFIX + id);
    await redis.srem(QUIZ_LIST_KEY, id);
  } catch (e) {
    console.error('[redis] deleteCachedQuiz error:', e);
  }
}

// Room state snapshot (for recovery after restart)
const ROOM_PREFIX = 'alihoot:room:';

export async function saveRoomSnapshot(pin: string, state: Record<string, unknown>): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(ROOM_PREFIX + pin, JSON.stringify(state), 'EX', 3600); // 1h TTL
  } catch (e) {
    console.error('[redis] saveRoomSnapshot error:', e);
  }
}

export async function getRoomSnapshot(pin: string): Promise<Record<string, unknown> | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    const data = await redis.get(ROOM_PREFIX + pin);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('[redis] getRoomSnapshot error:', e);
    return null;
  }
}

export async function deleteRoomSnapshot(pin: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(ROOM_PREFIX + pin);
  } catch (e) {
    console.error('[redis] deleteRoomSnapshot error:', e);
  }
}
