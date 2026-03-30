import {
  generatePin,
  generateId,
  generateToken,
  sanitize,
  sanitizeUrl,
  generateAvatar,
} from './utils';
import * as redis from './redis';

// ========== LIMITS ==========

export const LIMITS = {
  MAX_QUESTIONS: 50,
  MAX_CHOICES: 8,
  MAX_ITEMS: 10,
  MAX_ACCEPTED_ANSWERS: 20,
  MAX_TITLE_LENGTH: 100,
  MAX_QUESTION_TEXT_LENGTH: 300,
  MAX_CHOICE_LENGTH: 150,
  MAX_EXPLANATION_LENGTH: 500,
  MAX_NICKNAME_LENGTH: 20,
  MAX_ROOMS: 100,
} as const;
import * as db from './db';
import { Quiz, Question, Room, Avatar, LeaderboardEntry, AnswerResult, Reaction } from './types';

interface RawQuestionInput {
  text: string;
  type?: string;
  timeLimit?: number;
  pointsMultiplier?: number;
  image?: string;
  video?: string;
  explanation?: string;
  choices?: string[];
  correctIndex?: number;
  correctIndices?: number[];
  acceptedAnswers?: string[];
  items?: string[];
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  correctValue?: number;
  tolerance?: number;
  unit?: string;
}

export const quizzes: Record<string, Quiz> = {};
export const rooms: Record<string, Room> = {};

export function createQuiz(
  title: string,
  questions: RawQuestionInput[],
  options: { shuffleQuestions?: boolean; shuffleChoices?: boolean } = {},
): string | { error: string } {
  // Validate limits
  if (!title || typeof title !== 'string') return { error: 'Titre manquant' };
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return { error: 'Au moins une question requise' };
  }
  if (questions.length > LIMITS.MAX_QUESTIONS) {
    return { error: `Maximum ${LIMITS.MAX_QUESTIONS} questions par quiz` };
  }

  const id = generateId();
  quizzes[id] = {
    id,
    title: sanitize(title, LIMITS.MAX_TITLE_LENGTH),
    shuffleQuestions: !!options.shuffleQuestions,
    shuffleChoices: !!options.shuffleChoices,
    questions: questions.slice(0, LIMITS.MAX_QUESTIONS).map((q) => {
      const type = q.type || 'mcq';
      const validTypes = ['mcq', 'truefalse', 'multi', 'freetext', 'ordering', 'slider'];
      const safeType = validTypes.includes(type) ? type : 'mcq';

      const base = {
        text: sanitize(q.text, LIMITS.MAX_QUESTION_TEXT_LENGTH),
        type: safeType as Question['type'],
        timeLimit: Math.min(Math.max(Number(q.timeLimit) || 20, 5), 120),
        pointsMultiplier: Math.min(Math.max(Number(q.pointsMultiplier) || 1, 1), 3),
        image: q.image ? sanitizeUrl(q.image) : null,
        video: q.video ? sanitizeUrl(q.video) : null,
        explanation: q.explanation ? sanitize(q.explanation, LIMITS.MAX_EXPLANATION_LENGTH) : null,
        choices: [] as string[],
      };

      if (safeType === 'slider') {
        const sMin = Number(q.sliderMin) || 0;
        const sMax = Number(q.sliderMax) || 100;
        const sStep = Math.max(Number(q.sliderStep) || 1, 0.1);
        const correctVal = Number(q.correctValue) || 0;
        const tol = Math.max(Number(q.tolerance) || 0, 0);
        return {
          ...base,
          type: 'slider' as const,
          sliderMin: sMin,
          sliderMax: sMax,
          sliderStep: sStep,
          correctValue: correctVal,
          tolerance: tol,
          unit: sanitize(q.unit || '', 20),
        };
      } else if (safeType === 'ordering') {
        const items = (q.items || [])
          .slice(0, LIMITS.MAX_ITEMS)
          .map((i) => sanitize(i, LIMITS.MAX_CHOICE_LENGTH))
          .filter((i) => i);
        return {
          ...base,
          type: 'ordering' as const,
          items,
          correctOrder: items.map((_, i) => i),
        };
      } else if (safeType === 'truefalse') {
        return {
          ...base,
          type: 'truefalse' as const,
          choices: ['Vrai', 'Faux'],
          correctIndex: q.correctIndex === 1 ? 1 : 0,
        };
      } else if (safeType === 'freetext') {
        return {
          ...base,
          type: 'freetext' as const,
          acceptedAnswers: (q.acceptedAnswers || [])
            .slice(0, LIMITS.MAX_ACCEPTED_ANSWERS)
            .map((a) => sanitize(a, LIMITS.MAX_CHOICE_LENGTH).toLowerCase()),
        };
      } else if (safeType === 'multi') {
        return {
          ...base,
          type: 'multi' as const,
          choices: (q.choices || [])
            .slice(0, LIMITS.MAX_CHOICES)
            .map((c) => sanitize(c, LIMITS.MAX_CHOICE_LENGTH)),
          correctIndices: (q.correctIndices || []).filter(
            (i) => typeof i === 'number' && i >= 0 && i < LIMITS.MAX_CHOICES,
          ),
        };
      } else {
        return {
          ...base,
          type: 'mcq' as const,
          choices: (q.choices || [])
            .slice(0, LIMITS.MAX_CHOICES)
            .map((c) => sanitize(c, LIMITS.MAX_CHOICE_LENGTH))
            .filter((c) => c),
          correctIndex: Math.max(0, Math.min(Number(q.correctIndex) || 0, LIMITS.MAX_CHOICES - 1)),
        };
      }
    }) as Question[],
  };

  db.saveQuiz(id, quizzes[id].title, quizzes[id].questions, {
    shuffleQuestions: quizzes[id].shuffleQuestions,
    shuffleChoices: quizzes[id].shuffleChoices,
  }).catch(() => {});

  // Cache in Redis
  redis.cacheQuiz(id, quizzes[id]).catch(() => {});

  return id;
}

export function createRoom(quizId: string, adminSocketId: string): Room | null {
  const quiz = quizzes[quizId];
  if (!quiz) return null;
  if (Object.keys(rooms).length >= LIMITS.MAX_ROOMS) return null;

  const pin = generatePin(new Set(Object.keys(rooms)));
  const adminToken = generateToken();

  rooms[pin] = {
    pin,
    quizId,
    state: 'lobby',
    currentQuestionIndex: -1,
    players: {},
    adminSocketId,
    adminToken,
    questionStartedAt: null,
    timer: null,
    answeredCount: 0,
    reactions: {},
    fingerprints: new Set(),
    spectators: {},
    gameStartedAt: null,
  };
  return rooms[pin];
}

export async function ensureQuizLoaded(quizId: string): Promise<Quiz | null> {
  if (quizzes[quizId]) return quizzes[quizId];

  // Try Redis cache first
  const cached = (await redis.getCachedQuiz(quizId)) as Quiz | null;
  if (cached) {
    quizzes[quizId] = cached;
    return cached;
  }

  // Fallback to database
  const data = await db.loadQuiz(quizId);
  if (!data) return null;

  quizzes[quizId] = {
    id: data.id,
    title: data.title,
    shuffleQuestions: data.shuffle_questions || false,
    shuffleChoices: data.shuffle_choices || false,
    questions: data.questions,
  };

  // Cache for next time
  redis.cacheQuiz(quizId, quizzes[quizId]).catch(() => {});

  return quizzes[quizId];
}

export function createTrainingRoom(
  quizId: string,
  socketId: string,
  nickname: string,
  avatar: Avatar,
): Room | null {
  const quiz = quizzes[quizId];
  if (!quiz) return null;

  const pin = generatePin(new Set(Object.keys(rooms)));

  rooms[pin] = {
    pin,
    quizId,
    state: 'lobby',
    currentQuestionIndex: -1,
    players: {},
    adminSocketId: socketId,
    adminToken: generateToken(),
    questionStartedAt: null,
    timer: null,
    answeredCount: 0,
    reactions: {},
    fingerprints: new Set(),
    spectators: {},
    gameStartedAt: null,
    training: true,
  };

  rooms[pin].players[socketId] = {
    nickname: sanitize(nickname),
    score: 0,
    answers: [],
    connected: true,
    streak: 0,
    avatar,
    fingerprint: null,
  };

  return rooms[pin];
}

export function getRoom(pin: string): Room | null {
  return rooms[pin] || null;
}

export function getQuiz(quizId: string): Quiz | null {
  return quizzes[quizId] || null;
}

export function reconnectAdmin(pin: string, token: string, newSocketId: string): Room | null {
  const room = rooms[pin];
  if (!room || room.adminToken !== token) return null;
  room.adminSocketId = newSocketId;
  return room;
}

interface AddPlayerResult {
  error?: string;
  success?: boolean;
  spectator?: boolean;
  players?: { nickname: string; avatar: Avatar }[];
  nickname?: string;
  avatar?: Avatar;
  state?: string;
}

export function addPlayer(
  pin: string,
  socketId: string,
  nickname: string,
  fingerprint: string | null,
  customAvatar?: Avatar,
): AddPlayerResult {
  const room = rooms[pin];
  if (!room) return { error: 'Room introuvable' };
  if (room.training) return { error: "Session d'entraînement privée" };

  if (room.state !== 'lobby') {
    if (fingerprint) {
      const reconnect = reconnectPlayer(pin, socketId, fingerprint);
      if (reconnect.success) return reconnect;
    }
    return addSpectator(pin, socketId, nickname, customAvatar);
  }

  const cleanNick = sanitize(nickname, LIMITS.MAX_NICKNAME_LENGTH);
  if (!cleanNick) return { error: `Pseudo invalide (1-${LIMITS.MAX_NICKNAME_LENGTH} caractères)` };

  const nickTaken = Object.values(room.players).some(
    (p) => p.nickname.toLowerCase() === cleanNick.toLowerCase() && p.connected,
  );
  if (nickTaken) return { error: 'Ce pseudo est déjà pris' };

  if (fingerprint && room.fingerprints.has(fingerprint)) {
    return { error: 'Tu es déjà connecté depuis un autre onglet' };
  }
  if (fingerprint) room.fingerprints.add(fingerprint);

  const avatar =
    customAvatar && customAvatar.icon && customAvatar.color
      ? { icon: sanitize(customAvatar.icon), color: sanitize(customAvatar.color) }
      : generateAvatar();

  room.players[socketId] = {
    nickname: cleanNick,
    score: 0,
    answers: [],
    connected: true,
    streak: 0,
    avatar,
    fingerprint: fingerprint || null,
  };

  return { success: true, players: getPlayerList(pin), avatar };
}

// ========== SPECTATOR MODE ==========

export function addSpectator(
  pin: string,
  socketId: string,
  nickname: string,
  customAvatar?: Avatar,
): AddPlayerResult {
  const room = rooms[pin];
  if (!room) return { error: 'Room introuvable' };

  const cleanNick = sanitize(nickname || 'Spectateur');
  const avatar =
    customAvatar && customAvatar.icon && customAvatar.color
      ? { icon: sanitize(customAvatar.icon), color: sanitize(customAvatar.color) }
      : generateAvatar();

  room.spectators[socketId] = {
    nickname: cleanNick,
    avatar,
    connected: true,
  };

  return {
    spectator: true,
    nickname: cleanNick,
    avatar,
    state: room.state,
  };
}

export function kickPlayer(
  pin: string,
  adminSocketId: string,
  targetNickname: string,
): { socketId: string; players: { nickname: string; avatar: Avatar }[] } | null {
  const room = rooms[pin];
  if (!room || room.adminSocketId !== adminSocketId) return null;

  for (const [sid, player] of Object.entries(room.players)) {
    if (player.nickname === targetNickname) {
      if (player.fingerprint) room.fingerprints.delete(player.fingerprint);
      delete room.players[sid];
      return { socketId: sid, players: getPlayerList(pin) };
    }
  }
  return null;
}

export function removePlayer(
  socketId: string,
): { pin: string; isAdmin: boolean; isSpectator?: boolean } | null {
  for (const pin in rooms) {
    const room = rooms[pin];
    if (room.players[socketId]) {
      const player = room.players[socketId];
      player.connected = false;
      if (player.fingerprint) room.fingerprints.delete(player.fingerprint);
      return { pin, isAdmin: false };
    }
    if (room.spectators && room.spectators[socketId]) {
      delete room.spectators[socketId];
      return { pin, isAdmin: false, isSpectator: true };
    }
    if (room.adminSocketId === socketId) {
      return { pin, isAdmin: true };
    }
  }
  return null;
}

export function recordAnswer(
  pin: string,
  socketId: string,
  questionIndex: number,
  answerIndex: number | number[] | string,
): AnswerResult | null {
  const room = rooms[pin];
  if (!room || room.state !== 'question') return null;
  if (room.currentQuestionIndex !== questionIndex) return null;

  const player = room.players[socketId];
  if (!player) return null;

  const alreadyAnswered = player.answers.some((a) => a.questionIndex === questionIndex);
  if (alreadyAnswered) return null;

  const quiz = quizzes[room.quizId];
  const question = quiz.questions[questionIndex];
  const responseTime = (Date.now() - (room.questionStartedAt || 0)) / 1000;
  const timeLimit = question.timeLimit;

  let mappedAnswer: number | number[] | string = answerIndex;
  if (question._shuffleMap) {
    if (question.type === 'multi' && Array.isArray(answerIndex)) {
      mappedAnswer = answerIndex.map((i) => question._shuffleMap![i]);
    } else if (question.type === 'mcq' && typeof answerIndex === 'number') {
      mappedAnswer = question._shuffleMap[answerIndex];
    }
  }

  let correct = false; // eslint-disable-line no-useless-assignment
  if (question.type === 'slider') {
    const playerVal = Number(mappedAnswer);
    correct = Math.abs(playerVal - question.correctValue) <= question.tolerance;
  } else if (question.type === 'ordering') {
    correct = JSON.stringify(mappedAnswer) === JSON.stringify(question.correctOrder);
  } else if (question.type === 'multi') {
    const sorted1 = [...((mappedAnswer as number[]) || [])].sort();
    const sorted2 = [...(question.correctIndices || [])].sort();
    correct = JSON.stringify(sorted1) === JSON.stringify(sorted2);
  } else if (question.type === 'freetext') {
    const answer = String(mappedAnswer).toLowerCase().trim();
    correct = question.acceptedAnswers.includes(answer);
  } else {
    correct = mappedAnswer === question.correctIndex;
  }

  const multiplier = question.pointsMultiplier || 1;
  let points = 0;
  if (correct) {
    points = Math.round(1000 * (1 - responseTime / timeLimit / 2));
    points = Math.max(points, 500);
    player.streak++;
    if (player.streak > 1) {
      points += Math.min(player.streak * 100, 500);
    }
    points = Math.round(points * multiplier);
  } else {
    player.streak = 0;
  }

  player.score += points;
  player.answers.push({ questionIndex, answerIndex, responseTime, correct, points });
  room.answeredCount++;

  const result: AnswerResult = { correct, points };
  if (question.type === 'slider') {
    result.correctValue = question.correctValue;
    result.tolerance = question.tolerance;
    result.unit = question.unit;
  } else if (question.type === 'ordering') {
    result.correctOrder = question.correctOrder;
  } else if (question.type === 'multi') {
    result.correctIndices = question._shuffledCorrectIndices || question.correctIndices;
  } else if (question.type === 'freetext') {
    result.acceptedAnswers = question.acceptedAnswers;
  } else if (question.type === 'mcq') {
    result.correctIndex =
      question._shuffledCorrectIndex != null
        ? question._shuffledCorrectIndex
        : question.correctIndex;
  } else {
    result.correctIndex = question.correctIndex;
  }

  const sortedPlayers = Object.values(room.players).sort((a, b) => b.score - a.score);
  const playerRank = sortedPlayers.findIndex((p) => p.nickname === player.nickname) + 1;
  result.rank = playerRank;
  result.totalPlayers = sortedPlayers.length;
  result.totalScore = player.score;

  return result;
}

export function addReaction(
  pin: string,
  socketId: string,
  emoji: string,
): { nickname: string; emoji: string; avatar: Avatar } | null {
  const ALLOWED_EMOJIS = ['👏', '🔥', '😂', '😱', '💪'];
  if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) return null;

  const room = rooms[pin];
  if (!room) return null;
  const player = room.players[socketId];
  if (!player) return null;

  if (!room.reactions[room.currentQuestionIndex]) {
    room.reactions[room.currentQuestionIndex] = [];
  }
  const existing = room.reactions[room.currentQuestionIndex].find(
    (r: Reaction) => r.socketId === socketId,
  );
  if (existing) return null;

  room.reactions[room.currentQuestionIndex].push({
    socketId,
    nickname: player.nickname,
    emoji,
    avatar: player.avatar,
  });

  return { nickname: player.nickname, emoji, avatar: player.avatar };
}

export function getLeaderboard(pin: string): LeaderboardEntry[] {
  const room = rooms[pin];
  if (!room) return [];

  return Object.values(room.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      nickname: p.nickname,
      score: p.score,
      connected: p.connected,
      avatar: p.avatar,
      streak: p.streak,
    }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAnswerStats(pin: string, questionIndex: number): any {
  const room = rooms[pin];
  if (!room) return null;

  const quiz = quizzes[room.quizId];
  const question = quiz.questions[questionIndex];

  if (question.type === 'slider') {
    const answers: number[] = [];
    let correctCount = 0;
    let totalAnswered = 0;
    Object.values(room.players).forEach((p) => {
      const a = p.answers.find((ans) => ans.questionIndex === questionIndex);
      if (a) {
        totalAnswered++;
        answers.push(Number(a.answerIndex));
        if (a.correct) correctCount++;
      }
    });
    return {
      type: 'slider',
      correctValue: question.correctValue,
      tolerance: question.tolerance,
      unit: question.unit,
      sliderMin: question.sliderMin,
      sliderMax: question.sliderMax,
      answers,
      correctCount,
      totalAnswered,
      total: Object.keys(room.players).length,
    };
  }

  if (question.type === 'ordering') {
    let correctCount = 0;
    let totalAnswered = 0;
    Object.values(room.players).forEach((p) => {
      const a = p.answers.find((ans) => ans.questionIndex === questionIndex);
      if (a) {
        totalAnswered++;
        if (a.correct) correctCount++;
      }
    });
    return {
      type: 'ordering',
      items: question.items,
      correctCount,
      totalAnswered,
      total: Object.keys(room.players).length,
    };
  }

  if (question.type === 'freetext') {
    const answers: Record<string, number> = {};
    Object.values(room.players).forEach((p) => {
      const a = p.answers.find((ans) => ans.questionIndex === questionIndex);
      if (a) {
        const text = String(a.answerIndex).toLowerCase().trim();
        answers[text] = (answers[text] || 0) + 1;
      }
    });
    return {
      type: 'freetext',
      answers,
      acceptedAnswers: question.acceptedAnswers,
      total: Object.keys(room.players).length,
    };
  }

  const choiceCount = question.choices.length;
  const counts = new Array(choiceCount).fill(0);

  Object.values(room.players).forEach((p) => {
    const answer = p.answers.find((a) => a.questionIndex === questionIndex);
    if (answer) {
      if (question.type === 'multi' && Array.isArray(answer.answerIndex)) {
        answer.answerIndex.forEach((idx) => {
          if (idx >= 0 && idx < choiceCount) counts[idx]++;
        });
      } else if (
        typeof answer.answerIndex === 'number' &&
        answer.answerIndex >= 0 &&
        answer.answerIndex < choiceCount
      ) {
        counts[answer.answerIndex]++;
      }
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = { type: question.type, counts, total: Object.keys(room.players).length };
  if (question.type === 'multi') {
    result.correctIndices = question.correctIndices;
  } else {
    result.correctIndex = (question as { correctIndex: number }).correctIndex;
  }
  return result;
}

export function getPlayerList(pin: string): { nickname: string; avatar: Avatar }[] {
  const room = rooms[pin];
  if (!room) return [];
  return Object.entries(room.players)
    .filter(([, p]) => p.connected)
    .map(([, p]) => ({ nickname: p.nickname, avatar: p.avatar }));
}

export function getPlayerCount(pin: string): number {
  const room = rooms[pin];
  if (!room) return 0;
  return Object.values(room.players).filter((p) => p.connected).length;
}

export function deleteRoom(pin: string): void {
  const room = rooms[pin];
  if (room && room.timer) clearInterval(room.timer);
  delete rooms[pin];
}

// ========== GAME HISTORY ==========

export function saveGameHistory(pin: string): void {
  const room = rooms[pin];
  if (!room) return;

  const quiz = quizzes[room.quizId];
  const rankings = getLeaderboard(pin);

  db.saveGameHistory({
    quizTitle: quiz ? quiz.title : 'Quiz inconnu',
    quizId: room.quizId,
    pin,
    playerCount: Object.keys(room.players).length,
    questionCount: quiz ? quiz.questions.length : 0,
    rankings,
    startedAt: room.gameStartedAt || new Date().toISOString(),
  }).catch(() => {});
}

// ========== PLAYER RECONNECTION ==========

export function reconnectPlayer(
  pin: string,
  socketId: string,
  fingerprint: string,
): AddPlayerResult {
  const room = rooms[pin];
  if (!room) return { error: 'Room introuvable' };
  if (!fingerprint) return { error: 'Fingerprint manquant' };

  for (const [oldSocketId, player] of Object.entries(room.players)) {
    if (player.fingerprint === fingerprint && !player.connected) {
      player.connected = true;
      room.players[socketId] = player;
      if (oldSocketId !== socketId) {
        delete room.players[oldSocketId];
      }
      room.fingerprints.add(fingerprint);

      return {
        success: true,
        nickname: player.nickname,
        avatar: player.avatar,
        state: room.state,
      };
    }
  }

  return { error: 'Aucune session trouvee' };
}
