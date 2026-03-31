// Disable Supabase/Redis so the server runs in memory-only mode (no auth required)
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.REDIS_URL = '';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';

const { server, io: serverIo } = await import('../server');

// ─── Helpers ─────────────────────────────────────────────────────────

let baseUrl: string;

function connect(): ClientSocket {
  return ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), ms);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function emitAndWait<T = unknown>(
  socket: ClientSocket,
  emitEvent: string,
  payload: unknown,
  responseEvent: string,
  ms = 5000,
): Promise<T> {
  const promise = waitFor<T>(socket, responseEvent, ms);
  socket.emit(emitEvent, payload);
  return promise;
}

function waitConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.connected) return resolve();
    socket.once('connect', () => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run one question cycle: both players answer, wait time-up, show leaderboard */
async function playQuestion(
  admin: ClientSocket,
  player1: ClientSocket,
  player2: ClientSocket,
  pin: string,
  questionIndex: number,
  p1Answer: number | number[] | string,
  p2Answer: number | number[] | string,
): Promise<{
  p1: { correct: boolean; points: number };
  p2: { correct: boolean; points: number };
  timeUp: { explanation: string | null; explanationImage: string | null };
}> {
  // Listen for time-up before answering (in case all-answered triggers it instantly)
  const timeUpPromise = waitFor<{ explanation: string | null; explanationImage: string | null }>(
    admin,
    'game:time-up',
    15000,
  );

  const p1Result = await emitAndWait<{ correct: boolean; points: number }>(
    player1,
    'player:answer',
    { pin, questionIndex, answerIndex: p1Answer },
    'game:answer-result',
  );

  const p2Result = await emitAndWait<{ correct: boolean; points: number }>(
    player2,
    'player:answer',
    { pin, questionIndex, answerIndex: p2Answer },
    'game:answer-result',
  );

  // Wait for time-up (triggered by all-answered)
  const timeUp = await timeUpPromise;

  // Show leaderboard
  const lbPromise = waitFor(admin, 'game:leaderboard');
  admin.emit('admin:show-leaderboard', { pin });
  await lbPromise;

  return { p1: p1Result, p2: p2Result, timeUp };
}

// ─── Test quiz with all 6 question types ─────────────────────────────

const TEST_QUIZ = {
  title: 'Quiz E2E complet',
  questions: [
    {
      text: 'Quelle est la capitale de la France ?',
      type: 'mcq',
      choices: ['Lyon', 'Paris', 'Marseille', 'Toulouse'],
      correctIndex: 1,
      timeLimit: 10,
      explanation: 'Paris est la capitale depuis 508.',
      explanationImage: 'https://example.com/paris.jpg',
    },
    {
      text: 'La terre est ronde.',
      type: 'truefalse',
      correctIndex: 0,
      timeLimit: 10,
      explanation: null,
      explanationImage: 'https://example.com/earth.png',
    },
    {
      text: 'Quels sont des langages de programmation ?',
      type: 'multi',
      choices: ['JavaScript', 'HTML', 'Python', 'CSS'],
      correctIndices: [0, 2],
      timeLimit: 10,
    },
    {
      text: "Quel animal est le meilleur ami de l'homme ?",
      type: 'freetext',
      acceptedAnswers: ['chien', 'le chien'],
      timeLimit: 10,
    },
    {
      text: 'Classez du plus petit au plus grand',
      type: 'ordering',
      items: ['Souris', 'Chat', 'Elephant'],
      timeLimit: 10,
    },
    {
      text: 'Combien font 7 x 8 ?',
      type: 'slider',
      sliderMin: 0,
      sliderMax: 100,
      sliderStep: 1,
      correctValue: 56,
      tolerance: 0,
      unit: '',
      timeLimit: 10,
    },
  ],
};

// ─── Server lifecycle ────────────────────────────────────────────────

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      serverIo.close(() => {
        server.close(() => resolve());
      });
    }),
  30000,
);

// ─── E2E Tests ───────────────────────────────────────────────────────

describe('Quiz E2E – full game flow', { timeout: 120_000 }, () => {
  it('plays a complete 6-question quiz with 2 players and verifies scoring', async () => {
    // ── Setup: create quiz, room, connect players ──
    const admin = connect();
    await waitConnect(admin);

    const { quizId } = await emitAndWait<{ quizId: string }>(
      admin,
      'admin:create-quiz',
      TEST_QUIZ,
      'admin:quiz-created',
    );
    expect(quizId).toBeDefined();

    const { pin } = await emitAndWait<{ pin: string; adminToken: string }>(
      admin,
      'admin:create-room',
      { quizId },
      'admin:room-created',
    );
    expect(pin).toMatch(/^\d{6}$/);

    const player1 = connect();
    const player2 = connect();
    await Promise.all([waitConnect(player1), waitConnect(player2)]);

    const j1 = await emitAndWait<{ success: boolean; nickname: string }>(
      player1,
      'player:join',
      { pin, nickname: 'Alice', fingerprint: 'fp-alice', avatar: { icon: '🦊', color: '#e74c3c' } },
      'player:joined',
    );
    expect(j1.success).toBe(true);

    const j2 = await emitAndWait<{ success: boolean; nickname: string }>(
      player2,
      'player:join',
      { pin, nickname: 'Bob', fingerprint: 'fp-bob', avatar: { icon: '🐸', color: '#2ecc71' } },
      'player:joined',
    );
    expect(j2.success).toBe(true);

    // ── Start game ──
    const questionPromise = waitFor<{ questionIndex: number; type: string }>(admin, 'game:question', 10000);
    const startingPromise = waitFor<{ countdown: number }>(admin, 'game:starting');
    admin.emit('admin:start-game', { pin });

    const starting = await startingPromise;
    expect(starting.countdown).toBe(3);

    const q0 = await questionPromise;
    expect(q0.questionIndex).toBe(0);
    expect(q0.type).toBe('mcq');

    let p1Total = 0;
    let p2Total = 0;

    // ── Q1: MCQ — Alice correct, Bob wrong ──
    const q1 = await playQuestion(admin, player1, player2, pin, 0, 1, 0);
    expect(q1.p1.correct).toBe(true);
    expect(q1.p1.points).toBe(3);
    expect(q1.p2.correct).toBe(false);
    expect(q1.p2.points).toBe(0);
    // Explanation text + image should be present
    expect(q1.timeUp.explanation).toBe('Paris est la capitale depuis 508.');
    expect(q1.timeUp.explanationImage).toBe('https://example.com/paris.jpg');
    p1Total += q1.p1.points;
    p2Total += q1.p2.points;

    // Advance to Q2
    const q2Promise = waitFor<{ questionIndex: number; type: string }>(admin, 'game:question');
    admin.emit('admin:next-question', { pin });
    const q2Meta = await q2Promise;
    expect(q2Meta.questionIndex).toBe(1);
    expect(q2Meta.type).toBe('truefalse');

    // Small delay to avoid rate limiting (5 answers / 10s window)
    await sleep(2500);

    // ── Q2: True/False — Both correct ──
    const q2 = await playQuestion(admin, player1, player2, pin, 1, 0, 0);
    expect(q2.p1.correct).toBe(true);
    expect(q2.p1.points).toBe(3);
    expect(q2.p2.correct).toBe(true);
    expect(q2.p2.points).toBe(3);
    // Image only (no explanation text) should still be sent
    expect(q2.timeUp.explanation).toBeNull();
    expect(q2.timeUp.explanationImage).toBe('https://example.com/earth.png');
    p1Total += q2.p1.points;
    p2Total += q2.p2.points;

    // Advance to Q3
    const q3Promise = waitFor<{ questionIndex: number; type: string }>(admin, 'game:question');
    admin.emit('admin:next-question', { pin });
    const q3Meta = await q3Promise;
    expect(q3Meta.questionIndex).toBe(2);
    expect(q3Meta.type).toBe('multi');

    await sleep(2500);

    // ── Q3: Multi-select — Alice all correct (4pts), Bob partial (3pts) ──
    const q3 = await playQuestion(admin, player1, player2, pin, 2, [0, 2], [0]);
    expect(q3.p1.correct).toBe(true);
    expect(q3.p1.points).toBe(4); // 4 choices, all matching
    expect(q3.p2.correct).toBe(false);
    expect(q3.p2.points).toBe(3); // 3 out of 4 matching
    // No explanation on this question
    expect(q3.timeUp.explanation).toBeNull();
    expect(q3.timeUp.explanationImage).toBeNull();
    p1Total += q3.p1.points;
    p2Total += q3.p2.points;

    // Advance to Q4
    const q4Promise = waitFor<{ questionIndex: number; type: string }>(admin, 'game:question');
    admin.emit('admin:next-question', { pin });
    const q4Meta = await q4Promise;
    expect(q4Meta.questionIndex).toBe(3);
    expect(q4Meta.type).toBe('freetext');

    await sleep(2500);

    // ── Q4: Freetext — Alice correct, Bob wrong ──
    const q4 = await playQuestion(admin, player1, player2, pin, 3, 'chien', 'chat');
    expect(q4.p1.correct).toBe(true);
    expect(q4.p1.points).toBe(3);
    expect(q4.p2.correct).toBe(false);
    expect(q4.p2.points).toBe(0);
    p1Total += q4.p1.points;
    p2Total += q4.p2.points;

    // Advance to Q5
    const q5Promise = waitFor<{ questionIndex: number; type: string }>(admin, 'game:question');
    admin.emit('admin:next-question', { pin });
    const q5Meta = await q5Promise;
    expect(q5Meta.questionIndex).toBe(4);
    expect(q5Meta.type).toBe('ordering');

    await sleep(2500);

    // ── Q5: Ordering — Alice correct, Bob wrong ──
    const q5 = await playQuestion(admin, player1, player2, pin, 4, [0, 1, 2], [2, 0, 1]);
    expect(q5.p1.correct).toBe(true);
    expect(q5.p1.points).toBe(3);
    expect(q5.p2.correct).toBe(false);
    expect(q5.p2.points).toBe(0);
    p1Total += q5.p1.points;
    p2Total += q5.p2.points;

    // Advance to Q6
    const q6Promise = waitFor<{ questionIndex: number; type: string }>(admin, 'game:question');
    admin.emit('admin:next-question', { pin });
    const q6Meta = await q6Promise;
    expect(q6Meta.questionIndex).toBe(5);
    expect(q6Meta.type).toBe('slider');

    await sleep(2500);

    // ── Q6: Slider — Alice correct (56), Bob wrong (42) ──
    const q6 = await playQuestion(admin, player1, player2, pin, 5, '56', '42');
    expect(q6.p1.correct).toBe(true);
    expect(q6.p1.points).toBe(3);
    expect(q6.p2.correct).toBe(false);
    expect(q6.p2.points).toBe(0);
    p1Total += q6.p1.points;
    p2Total += q6.p2.points;

    // ── Game end ──
    const finishedPromise = waitFor<{
      podium: { nickname: string; score: number }[];
      rankings: { nickname: string; score: number }[];
      dashboard: { totalCorrect: number; totalAnswers: number };
    }>(admin, 'game:finished', 10000);

    admin.emit('admin:next-question', { pin });
    const result = await finishedPromise;

    // Final scores: Alice 3+3+4+3+3+3=19, Bob 0+3+3+0+0+0=6
    expect(p1Total).toBe(19);
    expect(p2Total).toBe(6);

    expect(result.podium[0].nickname).toBe('Alice');
    expect(result.podium[0].score).toBe(19);
    expect(result.podium[1].nickname).toBe('Bob');
    expect(result.podium[1].score).toBe(6);

    // Dashboard
    expect(result.dashboard.totalAnswers).toBe(12); // 6 questions × 2 players
    expect(result.dashboard.totalCorrect).toBe(7); // Alice: 6 correct, Bob: 1 correct (Q2 true/false)

    expect(result.rankings).toHaveLength(2);
    expect(result.rankings[0].score).toBeGreaterThanOrEqual(result.rankings[1].score);

    admin.disconnect();
    player1.disconnect();
    player2.disconnect();
  });

  it('rejects duplicate answers on the same question', async () => {
    // New sockets to avoid rate limit from previous test
    const admin2 = connect();
    await waitConnect(admin2);

    const { quizId } = await emitAndWait<{ quizId: string }>(
      admin2,
      'admin:create-quiz',
      {
        title: 'Dupe test',
        questions: [
          { text: 'Q1', type: 'mcq', choices: ['A', 'B'], correctIndex: 0, timeLimit: 30 },
        ],
      },
      'admin:quiz-created',
    );

    const { pin } = await emitAndWait<{ pin: string; adminToken: string }>(
      admin2,
      'admin:create-room',
      { quizId },
      'admin:room-created',
    );

    const p = connect();
    await waitConnect(p);
    await emitAndWait(
      p,
      'player:join',
      { pin, nickname: 'Dupey', fingerprint: 'fp-dupe', avatar: { icon: '🐱', color: '#fff' } },
      'player:joined',
    );

    const qPromise = waitFor(p, 'game:question', 10000);
    admin2.emit('admin:start-game', { pin });
    await qPromise;

    // First answer: register listener BEFORE emitting
    const r1 = await emitAndWait<{ correct: boolean }>(
      p,
      'player:answer',
      { pin, questionIndex: 0, answerIndex: 0 },
      'game:answer-result',
    );
    expect(r1.correct).toBe(true);

    // Second answer: should be silently ignored (duplicate)
    // Register listener first, then emit, wait for timeout
    const dupeListener = waitFor(p, 'game:answer-result', 1500).then(() => 'received').catch(() => 'timeout');
    p.emit('player:answer', { pin, questionIndex: 0, answerIndex: 1 });
    const duplicateResult = await dupeListener;
    expect(duplicateResult).toBe('timeout');

    admin2.disconnect();
    p.disconnect();
  });

  it('rejects joining with an invalid pin', async () => {
    const p = connect();
    await waitConnect(p);

    const err = await emitAndWait<{ message: string }>(
      p,
      'player:join',
      { pin: '000000', nickname: 'Ghost', fingerprint: 'fp-ghost', avatar: { icon: '👻', color: '#000' } },
      'player:error',
      2000,
    );
    expect(err.message).toBeDefined();

    p.disconnect();
  });
});
