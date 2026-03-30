import * as store from './store';
import { Server } from 'socket.io';
import { Dashboard, QuestionStats } from './types';

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startGame(pin: string, io: Server): boolean {
  const room = store.getRoom(pin);
  if (!room || room.state !== 'lobby') return false;

  const quiz = store.getQuiz(room.quizId);
  if (!quiz) return false;

  if (quiz.shuffleQuestions) {
    quiz.questions = shuffleArray(quiz.questions);
  }

  room.state = 'question';
  room.gameStartedAt = new Date().toISOString();
  io.to(`room:${pin}`).emit('game:starting', { countdown: 3 });
  setTimeout(() => broadcastQuestion(pin, io), 3000);
  return true;
}

function broadcastQuestion(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room) return;

  room.currentQuestionIndex++;
  room.answeredCount = 0;
  room.questionStartedAt = Date.now();

  const quiz = store.getQuiz(room.quizId)!;
  const question = quiz.questions[room.currentQuestionIndex];

  room.state = 'question';

  let choices = question.choices;
  if (quiz.shuffleChoices && question.type !== 'truefalse' && question.type !== 'freetext') {
    const indices = question.choices.map((_, i) => i);
    const shuffled = shuffleArray(indices);
    choices = shuffled.map((i) => question.choices[i]);

    if (question.type === 'multi') {
      question._shuffledCorrectIndices = (question.correctIndices || []).map((ci) =>
        shuffled.indexOf(ci),
      );
    } else if (question.type === 'mcq') {
      question._shuffledCorrectIndex = shuffled.indexOf(question.correctIndex);
    }
    question._shuffleMap = shuffled;
  } else {
    question._shuffleMap = null;
  }

  let orderingItems: { item: string; originalIndex: number }[] | null = null;
  if (question.type === 'ordering') {
    orderingItems = shuffleArray(question.items.map((item, i) => ({ item, originalIndex: i })));
  }

  // Slider data
  let sliderData: {
    sliderMin: number;
    sliderMax: number;
    sliderStep: number;
    unit: string;
  } | null = null;
  if (question.type === 'slider') {
    sliderData = {
      sliderMin: question.sliderMin,
      sliderMax: question.sliderMax,
      sliderStep: question.sliderStep,
      unit: question.unit,
    };
  }

  const payload = {
    questionIndex: room.currentQuestionIndex,
    text: question.text,
    choices,
    timeLimit: question.timeLimit,
    total: quiz.questions.length,
    type: question.type,
    image: question.image || null,
    video: question.video || null,
    pointsMultiplier: question.pointsMultiplier || 1,
    orderingItems: orderingItems ? orderingItems.map((o) => o.item) : null,
    orderingMap: orderingItems ? orderingItems.map((o) => o.originalIndex) : null,
    slider: sliderData,
  };

  io.to(`room:${pin}`).emit('game:question', payload);
  io.to(`room:${pin}`).emit('audio:play', { sound: 'question-start' });

  startTimer(pin, io, question.timeLimit);
}

function startTimer(pin: string, io: Server, timeLimit: number): void {
  const room = store.getRoom(pin);
  if (!room) return;

  if (room.timer) clearInterval(room.timer);

  let remaining = timeLimit;

  room.timer = setInterval(() => {
    remaining--;
    room._pausedRemaining = remaining;
    io.to(`room:${pin}`).emit('game:timer-tick', { remaining });

    if (remaining <= 5 && remaining > 0) {
      io.to(`room:${pin}`).emit('audio:play', { sound: 'tick' });
    }

    if (remaining <= 0) {
      clearInterval(room.timer!);
      room.timer = null;
      timeUp(pin, io);
    }
  }, 1000);
}

function timeUp(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room) return;

  const quiz = store.getQuiz(room.quizId)!;
  const question = quiz.questions[room.currentQuestionIndex];

  room.state = 'time-up';
  const explanation = question.explanation || null;
  io.to(`room:${pin}`).emit('game:time-up', { explanation });
  io.to(`room:${pin}`).emit('audio:play', { sound: 'time-up' });

  const stats = store.getAnswerStats(pin, room.currentQuestionIndex);
  stats.explanation = explanation;
  io.to(room.adminSocketId).emit('game:answer-stats', stats);

  // Training mode: auto-advance
  if (room.training) {
    scheduleTrainingAdvance(pin, io);
  }
}

function scheduleTrainingAdvance(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room || !room.training) return;

  // Clear any existing training timers
  clearTrainingTimers(room);
  room._trainingTimers = [];

  room._trainingTimers.push(
    setTimeout(() => {
      const r = store.getRoom(pin);
      if (!r || r.state === 'finished') return;
      showLeaderboard(pin, io);
    }, 2000),
  );

  room._trainingTimers.push(
    setTimeout(() => {
      const r = store.getRoom(pin);
      if (!r || r.state === 'finished') return;
      nextQuestion(pin, io);
    }, 5000),
  );
}

function clearTrainingTimers(room: { _trainingTimers?: ReturnType<typeof setTimeout>[] }): void {
  if (room._trainingTimers) {
    room._trainingTimers.forEach((t) => clearTimeout(t));
    room._trainingTimers = [];
  }
}

export function handleAnswer(
  pin: string,
  socketId: string,
  questionIndex: number,
  answerIndex: number | number[] | string,
  io: Server,
): void {
  const result = store.recordAnswer(pin, socketId, questionIndex, answerIndex);
  if (!result) return;

  io.to(socketId).emit('game:answer-result', result);

  if (result.correct) {
    io.to(socketId).emit('audio:play', { sound: 'correct' });
  } else {
    io.to(socketId).emit('audio:play', { sound: 'wrong' });
  }

  const room = store.getRoom(pin);
  if (room) {
    const playerCount = store.getPlayerCount(pin);
    // Broadcast to admin AND all players
    io.to(`room:${pin}`).emit('game:answer-count', {
      answered: room.answeredCount,
      total: playerCount,
    });

    if (room.answeredCount >= playerCount && room.timer) {
      clearInterval(room.timer);
      room.timer = null;
      timeUp(pin, io);
    }
  }
}

export function showLeaderboard(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room) return;

  room.state = 'leaderboard';
  const rankings = store.getLeaderboard(pin);
  io.to(`room:${pin}`).emit('game:leaderboard', { rankings });
  io.to(`room:${pin}`).emit('audio:play', { sound: 'leaderboard' });
}

export function nextQuestion(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room) return;

  const quiz = store.getQuiz(room.quizId)!;
  if (room.currentQuestionIndex >= quiz.questions.length - 1) {
    endGame(pin, io);
  } else {
    broadcastQuestion(pin, io);
  }
}

function endGame(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room) return;

  room.state = 'finished';
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  const rankings = store.getLeaderboard(pin);
  const podium = rankings.slice(0, 3);
  const dashboard = generateDashboard(pin);

  io.to(`room:${pin}`).emit('game:finished', { podium, rankings, dashboard });
  io.to(`room:${pin}`).emit('audio:play', { sound: 'victory' });

  store.saveGameHistory(pin);

  // Training mode: auto-cleanup after 60s
  if (room.training) {
    clearTrainingTimers(room);
    setTimeout(() => store.deleteRoom(pin), 60000);
  }
}

// ========== PAUSE ==========

export function togglePause(pin: string, io: Server): void {
  const room = store.getRoom(pin);
  if (!room) return;

  if (room.paused) {
    room.paused = false;
    io.to(`room:${pin}`).emit('game:resumed');

    if (room._pausedRemaining && room._pausedRemaining > 0 && room.state === 'question') {
      startTimer(pin, io, room._pausedRemaining);
    }
  } else {
    room.paused = true;

    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }

    io.to(`room:${pin}`).emit('game:paused');
  }
}

// ========== DASHBOARD ==========

export function generateDashboard(pin: string): Dashboard | null {
  const room = store.getRoom(pin);
  if (!room) return null;

  const quiz = store.getQuiz(room.quizId);
  if (!quiz) return null;

  const players = Object.values(room.players);
  const questionCount = quiz.questions.length;

  const perQuestion: QuestionStats[] = [];
  let totalCorrect = 0;
  let totalAnswers = 0;
  const allResponseTimes: number[] = [];

  for (let qi = 0; qi < questionCount; qi++) {
    let correct = 0;
    let answered = 0;

    players.forEach((p) => {
      const a = p.answers.find((ans) => ans.questionIndex === qi);
      if (a) {
        answered++;
        totalAnswers++;
        allResponseTimes.push(a.responseTime);
        if (a.correct) {
          correct++;
          totalCorrect++;
        }
      }
    });

    perQuestion.push({
      text: quiz.questions[qi].text,
      correctPct: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      answered,
      correct,
    });
  }

  const answeredQuestions = perQuestion.filter((q) => q.answered > 0);
  const sorted = [...answeredQuestions].sort((a, b) => a.correctPct - b.correctPct);
  const hardestQuestion = sorted.length > 0 ? sorted[0] : null;
  const easiestQuestion = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  const avgResponseTime =
    allResponseTimes.length > 0
      ? (allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length).toFixed(1)
      : null;

  let fastestPlayer: { nickname: string; avgTime: string } | null = null;
  let bestStreak: { nickname: string; count: number } | null = null;

  for (const p of players) {
    if (p.answers.length === 0) continue;
    const avgTime = (
      p.answers.reduce((sum, a) => sum + a.responseTime, 0) / p.answers.length
    ).toFixed(1);
    if (!fastestPlayer || parseFloat(avgTime) < parseFloat(fastestPlayer.avgTime)) {
      fastestPlayer = { nickname: p.nickname, avgTime };
    }

    let streak = 0;
    let maxStreak = 0;
    for (const a of p.answers) {
      if (a.correct) {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }
    if (!bestStreak || maxStreak > bestStreak.count) {
      bestStreak = { nickname: p.nickname, count: maxStreak };
    }
  }

  return {
    perQuestion,
    hardestQuestion,
    easiestQuestion,
    avgResponseTime,
    fastestPlayer,
    bestStreak: bestStreak && bestStreak.count > 1 ? bestStreak : null,
    totalCorrect,
    totalAnswers,
    totalCorrectPct: totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0,
  };
}
