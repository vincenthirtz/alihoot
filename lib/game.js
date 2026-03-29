const store = require('./store');

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startGame(pin, io) {
  const room = store.getRoom(pin);
  if (!room || room.state !== 'lobby') return false;

  const quiz = store.getQuiz(room.quizId);
  if (quiz.shuffleQuestions) {
    quiz.questions = shuffleArray(quiz.questions);
  }

  room.state = 'question';
  room.gameStartedAt = new Date().toISOString();
  io.to(`room:${pin}`).emit('game:starting', { countdown: 3 });
  setTimeout(() => broadcastQuestion(pin, io), 3000);
  return true;
}

function broadcastQuestion(pin, io) {
  const room = store.getRoom(pin);
  if (!room) return;

  room.currentQuestionIndex++;
  room.answeredCount = 0;
  room.questionStartedAt = Date.now();

  const quiz = store.getQuiz(room.quizId);
  const question = quiz.questions[room.currentQuestionIndex];

  room.state = 'question';

  // Shuffle choices if enabled (not for truefalse/freetext)
  let choices = question.choices;
  if (quiz.shuffleChoices && question.type !== 'truefalse' && question.type !== 'freetext') {
    const indices = question.choices.map((_, i) => i);
    const shuffled = shuffleArray(indices);
    choices = shuffled.map(i => question.choices[i]);

    // Remap correct answer indices for this round
    if (question.type === 'multi') {
      question._shuffledCorrectIndices = (question.correctIndices || []).map(ci => shuffled.indexOf(ci));
    } else if (question.type === 'mcq') {
      question._shuffledCorrectIndex = shuffled.indexOf(question.correctIndex);
    }
    question._shuffleMap = shuffled; // original index at each new position
  } else {
    question._shuffleMap = null;
  }

  // For ordering type, send shuffled items
  let orderingItems = null;
  if (question.type === 'ordering') {
    orderingItems = shuffleArray(question.items.map((item, i) => ({ item, originalIndex: i })));
  }

  const payload = {
    questionIndex: room.currentQuestionIndex,
    text: question.text,
    choices,
    timeLimit: question.timeLimit,
    total: quiz.questions.length,
    type: question.type,
    image: question.image || null,
    pointsMultiplier: question.pointsMultiplier || 1,
    orderingItems: orderingItems ? orderingItems.map(o => o.item) : null,
    orderingMap: orderingItems ? orderingItems.map(o => o.originalIndex) : null
  };

  // For multi type, don't send correctIndices
  // For freetext, no choices to hide
  io.to(`room:${pin}`).emit('game:question', payload);
  io.to(`room:${pin}`).emit('audio:play', { sound: 'question-start' });

  startTimer(pin, io, question.timeLimit);
}

function startTimer(pin, io, timeLimit) {
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
      clearInterval(room.timer);
      room.timer = null;
      timeUp(pin, io);
    }
  }, 1000);
}

function timeUp(pin, io) {
  const room = store.getRoom(pin);
  if (!room) return;

  const quiz = store.getQuiz(room.quizId);
  const question = quiz.questions[room.currentQuestionIndex];

  room.state = 'time-up';
  const explanation = question.explanation || null;
  io.to(`room:${pin}`).emit('game:time-up', { explanation });
  io.to(`room:${pin}`).emit('audio:play', { sound: 'time-up' });

  const stats = store.getAnswerStats(pin, room.currentQuestionIndex);
  stats.explanation = explanation;
  io.to(room.adminSocketId).emit('game:answer-stats', stats);
}

function handleAnswer(pin, socketId, questionIndex, answerIndex, io) {
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
    io.to(room.adminSocketId).emit('game:answer-count', {
      answered: room.answeredCount,
      total: playerCount
    });

    if (room.answeredCount >= playerCount && room.timer) {
      clearInterval(room.timer);
      room.timer = null;
      timeUp(pin, io);
    }
  }
}

function showLeaderboard(pin, io) {
  const room = store.getRoom(pin);
  if (!room) return;

  room.state = 'leaderboard';
  const rankings = store.getLeaderboard(pin);
  io.to(`room:${pin}`).emit('game:leaderboard', { rankings });
  io.to(`room:${pin}`).emit('audio:play', { sound: 'leaderboard' });
}

function nextQuestion(pin, io) {
  const room = store.getRoom(pin);
  if (!room) return;

  const quiz = store.getQuiz(room.quizId);
  if (room.currentQuestionIndex >= quiz.questions.length - 1) {
    endGame(pin, io);
  } else {
    broadcastQuestion(pin, io);
  }
}

function endGame(pin, io) {
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

  // Save game history to Supabase
  store.saveGameHistory(pin);
}

// ========== PAUSE ==========

function togglePause(pin, io) {
  const room = store.getRoom(pin);
  if (!room) return;

  if (room.paused) {
    // Resume
    room.paused = false;
    io.to(`room:${pin}`).emit('game:resumed');

    // Restart timer with remaining time
    if (room._pausedRemaining > 0 && room.state === 'question') {
      startTimer(pin, io, room._pausedRemaining);
    }
  } else {
    // Pause
    room.paused = true;

    // Stop the timer and save remaining time
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }

    io.to(`room:${pin}`).emit('game:paused');
  }
}

// ========== DASHBOARD ==========

function generateDashboard(pin) {
  const room = store.getRoom(pin);
  if (!room) return null;

  const quiz = store.getQuiz(room.quizId);
  if (!quiz) return null;

  const players = Object.values(room.players);
  const questionCount = quiz.questions.length;

  // Per-question stats
  const perQuestion = [];
  let totalCorrect = 0;
  let totalAnswers = 0;
  let allResponseTimes = [];

  for (let qi = 0; qi < questionCount; qi++) {
    let correct = 0;
    let answered = 0;

    players.forEach(p => {
      const a = p.answers.find(a => a.questionIndex === qi);
      if (a) {
        answered++;
        totalAnswers++;
        allResponseTimes.push(a.responseTime);
        if (a.correct) { correct++; totalCorrect++; }
      }
    });

    perQuestion.push({
      text: quiz.questions[qi].text,
      correctPct: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      answered,
      correct
    });
  }

  // Hardest & easiest questions
  const answeredQuestions = perQuestion.filter(q => q.answered > 0);
  const sorted = [...answeredQuestions].sort((a, b) => a.correctPct - b.correctPct);
  const hardestQuestion = sorted.length > 0 ? sorted[0] : null;
  const easiestQuestion = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  // Average response time
  const avgResponseTime = allResponseTimes.length > 0
    ? (allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length).toFixed(1)
    : null;

  // Fastest player (lowest average response time)
  let fastestPlayer = null;
  let bestStreak = null;

  players.forEach(p => {
    if (p.answers.length === 0) return;
    const avgTime = (p.answers.reduce((sum, a) => sum + a.responseTime, 0) / p.answers.length).toFixed(1);
    if (!fastestPlayer || parseFloat(avgTime) < parseFloat(fastestPlayer.avgTime)) {
      fastestPlayer = { nickname: p.nickname, avgTime };
    }

    // Find best streak in answer history
    let streak = 0;
    let maxStreak = 0;
    p.answers.forEach(a => {
      if (a.correct) { streak++; maxStreak = Math.max(maxStreak, streak); }
      else { streak = 0; }
    });
    if (!bestStreak || maxStreak > bestStreak.count) {
      bestStreak = { nickname: p.nickname, count: maxStreak };
    }
  });

  return {
    perQuestion,
    hardestQuestion,
    easiestQuestion,
    avgResponseTime,
    fastestPlayer,
    bestStreak: bestStreak && bestStreak.count > 1 ? bestStreak : null,
    totalCorrect,
    totalAnswers,
    totalCorrectPct: totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0
  };
}

module.exports = { startGame, handleAnswer, showLeaderboard, nextQuestion, togglePause, generateDashboard };
