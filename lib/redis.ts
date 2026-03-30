import Redis from 'ioredis';
import log from './logger';
import { REDIS } from './config';

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
      log.error({ err: err.message }, 'Redis connection error');
    });

    client.on('connect', () => {
      log.info('Redis connected');
    });

    return client;
  } catch (e) {
    log.error({ err: e }, 'Redis failed to initialize');
    return null;
  }
}

export function isAvailable(): boolean {
  return client !== null && client.status === 'ready';
}

// Quiz cache (persists across restarts)
const QUIZ_PREFIX = 'alihoot:quiz:';
const QUIZ_LIST_KEY = 'alihoot:quiz_ids';
const QUIZ_TTL = REDIS.QUIZ_TTL;

export async function cacheQuiz(id: string, quiz: unknown): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(QUIZ_PREFIX + id, JSON.stringify(quiz), 'EX', QUIZ_TTL);
    await redis.sadd(QUIZ_LIST_KEY, id);
  } catch (e) {
    log.error({ err: e }, 'Redis cacheQuiz error');
  }
}

export async function getCachedQuiz(id: string): Promise<unknown | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    const data = await redis.get(QUIZ_PREFIX + id);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    log.error({ err: e }, 'Redis getCachedQuiz error');
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
    log.error({ err: e }, 'Redis deleteCachedQuiz error');
  }
}

// Room state snapshot (for recovery after restart)
const ROOM_PREFIX = 'alihoot:room:';

export async function saveRoomSnapshot(pin: string, state: Record<string, unknown>): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(ROOM_PREFIX + pin, JSON.stringify(state), 'EX', REDIS.ROOM_SNAPSHOT_TTL);
  } catch (e) {
    log.error({ err: e }, 'Redis saveRoomSnapshot error');
  }
}

export async function getRoomSnapshot(pin: string): Promise<Record<string, unknown> | null> {
  const redis = getClient();
  if (!redis) return null;
  try {
    const data = await redis.get(ROOM_PREFIX + pin);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    log.error({ err: e }, 'Redis getRoomSnapshot error');
    return null;
  }
}

export async function deleteRoomSnapshot(pin: string): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(ROOM_PREFIX + pin);
  } catch (e) {
    log.error({ err: e }, 'Redis deleteRoomSnapshot error');
  }
}
