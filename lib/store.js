const { generatePin, generateId, generateToken, sanitize, generateAvatar } = require('./utils');
const db = require('./db');

const quizzes = {};
const rooms = {};

function createQuiz(title, questions, options = {}) {
  const id = generateId();
  quizzes[id] = {
    id,
    title: sanitize(title),
    shuffleQuestions: !!options.shuffleQuestions,
    shuffleChoices: !!options.shuffleChoices,
    questions: questions.map(q => {
      const type = q.type || 'mcq'; // mcq, truefalse, multi, freetext
      const base = {
        text: sanitize(q.text),
        type,
        timeLimit: Math.min(Math.max(Number(q.timeLimit) || 20, 5), 120),
        pointsMultiplier: Math.min(Math.max(Number(q.pointsMultiplier) || 1, 1), 3),
        image: q.image ? sanitize(q.image) : null,
        explanation: q.explanation ? sanitize(q.explanation) : null
      };

      if (type === 'ordering') {
        base.items = (q.items || []).map(i => sanitize(i)).filter(i => i);
        base.correctOrder = base.items.map((_, i) => i); // correct order is as entered
        base.choices = [];
      } else if (type === 'truefalse') {
        base.choices = ['Vrai', 'Faux'];
        base.correctIndex = q.correctIndex === 1 ? 1 : 0;
      } else if (type === 'freetext') {
        base.choices = [];
        base.acceptedAnswers = (q.acceptedAnswers || []).map(a => sanitize(a).toLowerCase());
      } else if (type === 'multi') {
        base.choices = (q.choices || []).map(c => sanitize(c));
        base.correctIndices = q.correctIndices || [];
      } else {
        // mcq - variable number of choices (2-4)
        base.choices = (q.choices || []).map(c => sanitize(c)).filter(c => c);
        base.correctIndex = Number(q.correctIndex);
      }
      return base;
    })
  };

  // Persist to Supabase (async, non-blocking)
  db.saveQuiz(id, quizzes[id].title, quizzes[id].questions, {
    shuffleQuestions: quizzes[id].shuffleQuestions,
    shuffleChoices: quizzes[id].shuffleChoices
  }).catch(() => {});

  return id;
}

function createRoom(quizId, adminSocketId) {
  const quiz = quizzes[quizId];
  if (!quiz) return null;

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
    gameStartedAt: null
  };
  return rooms[pin];
}

function getRoom(pin) {
  return rooms[pin] || null;
}

function getQuiz(quizId) {
  return quizzes[quizId] || null;
}

function reconnectAdmin(pin, token, newSocketId) {
  const room = rooms[pin];
  if (!room || room.adminToken !== token) return null;
  room.adminSocketId = newSocketId;
  return room;
}

function addPlayer(pin, socketId, nickname, fingerprint, customAvatar) {
  const room = rooms[pin];
  if (!room) return { error: 'Room introuvable' };

  // If game already started, try reconnection via fingerprint or join as spectator
  if (room.state !== 'lobby') {
    if (fingerprint) {
      const reconnect = reconnectPlayer(pin, socketId, fingerprint);
      if (reconnect.success) return reconnect;
    }
    // Allow spectator mode
    return addSpectator(pin, socketId, nickname, customAvatar);
  }

  const cleanNick = sanitize(nickname);
  if (!cleanNick || cleanNick.length > 20) return { error: 'Pseudo invalide (1-20 caracteres)' };

  const nickTaken = Object.values(room.players).some(
    p => p.nickname.toLowerCase() === cleanNick.toLowerCase() && p.connected
  );
  if (nickTaken) return { error: 'Ce pseudo est deja pris' };

  // Anti-cheat: block duplicate fingerprints
  if (fingerprint && room.fingerprints.has(fingerprint)) {
    return { error: 'Tu es deja connecte depuis un autre onglet' };
  }
  if (fingerprint) room.fingerprints.add(fingerprint);

  // Use custom avatar if provided, otherwise generate random
  const avatar = (customAvatar && customAvatar.icon && customAvatar.color)
    ? { icon: sanitize(customAvatar.icon), color: sanitize(customAvatar.color) }
    : generateAvatar();

  room.players[socketId] = {
    nickname: cleanNick,
    score: 0,
    answers: [],
    connected: true,
    streak: 0,
    avatar,
    fingerprint: fingerprint || null
  };

  return { success: true, players: getPlayerList(pin), avatar };
}

// ========== SPECTATOR MODE ==========

function addSpectator(pin, socketId, nickname, customAvatar) {
  const room = rooms[pin];
  if (!room) return { error: 'Room introuvable' };

  const cleanNick = sanitize(nickname || 'Spectateur');
  const avatar = (customAvatar && customAvatar.icon && customAvatar.color)
    ? { icon: sanitize(customAvatar.icon), color: sanitize(customAvatar.color) }
    : generateAvatar();

  // Store spectator separately (not in players — they don't score)
  if (!room.spectators) room.spectators = {};
  room.spectators[socketId] = {
    nickname: cleanNick,
    avatar,
    connected: true
  };

  return {
    spectator: true,
    nickname: cleanNick,
    avatar,
    state: room.state
  };
}

function removeSpectator(socketId) {
  for (const pin in rooms) {
    const room = rooms[pin];
    if (room.spectators && room.spectators[socketId]) {
      delete room.spectators[socketId];
      return { pin, isSpectator: true };
    }
  }
  return null;
}

function kickPlayer(pin, adminSocketId, targetNickname) {
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

function removePlayer(socketId) {
  for (const pin in rooms) {
    const room = rooms[pin];
    if (room.players[socketId]) {
      const player = room.players[socketId];
      player.connected = false;
      if (player.fingerprint) room.fingerprints.delete(player.fingerprint);
      return { pin, isAdmin: false };
    }
    // Check spectators
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

function recordAnswer(pin, socketId, questionIndex, answerIndex) {
  const room = rooms[pin];
  if (!room || room.state !== 'question') return null;
  if (room.currentQuestionIndex !== questionIndex) return null;

  const player = room.players[socketId];
  if (!player) return null;

  const alreadyAnswered = player.answers.some(a => a.questionIndex === questionIndex);
  if (alreadyAnswered) return null;

  const quiz = quizzes[room.quizId];
  const question = quiz.questions[questionIndex];
  const responseTime = (Date.now() - room.questionStartedAt) / 1000;
  const timeLimit = question.timeLimit;

  // Unmap shuffled indices back to original if shuffle was active
  let mappedAnswer = answerIndex;
  if (question._shuffleMap) {
    if (question.type === 'multi' && Array.isArray(answerIndex)) {
      mappedAnswer = answerIndex.map(i => question._shuffleMap[i]);
    } else if (question.type === 'mcq' && typeof answerIndex === 'number') {
      mappedAnswer = question._shuffleMap[answerIndex];
    }
  }

  let correct = false;
  if (question.type === 'ordering') {
    // answerIndex is an array of indices representing the player's ordering
    correct = JSON.stringify(mappedAnswer) === JSON.stringify(question.correctOrder);
  } else if (question.type === 'multi') {
    const sorted1 = [...(mappedAnswer || [])].sort();
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
    points = Math.round(1000 * (1 - (responseTime / timeLimit) / 2));
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

  const result = { correct, points };
  if (question.type === 'ordering') {
    result.correctOrder = question.correctOrder;
  } else if (question.type === 'multi') {
    result.correctIndices = question._shuffledCorrectIndices || question.correctIndices;
  } else if (question.type === 'freetext') {
    result.acceptedAnswers = question.acceptedAnswers;
  } else if (question.type === 'mcq') {
    result.correctIndex = (question._shuffledCorrectIndex != null) ? question._shuffledCorrectIndex : question.correctIndex;
  } else {
    result.correctIndex = question.correctIndex;
  }

  // Add real-time rank info
  const sortedPlayers = Object.values(room.players).sort((a, b) => b.score - a.score);
  const playerRank = sortedPlayers.findIndex(p => p.nickname === player.nickname) + 1;
  result.rank = playerRank;
  result.totalPlayers = sortedPlayers.length;
  result.totalScore = player.score;

  return result;
}

function addReaction(pin, socketId, emoji) {
  const room = rooms[pin];
  if (!room) return null;
  const player = room.players[socketId];
  if (!player) return null;

  if (!room.reactions[room.currentQuestionIndex]) {
    room.reactions[room.currentQuestionIndex] = [];
  }
  // Max 1 reaction per player per question
  const existing = room.reactions[room.currentQuestionIndex].find(r => r.socketId === socketId);
  if (existing) return null;

  room.reactions[room.currentQuestionIndex].push({
    socketId,
    nickname: player.nickname,
    emoji,
    avatar: player.avatar
  });

  return { nickname: player.nickname, emoji, avatar: player.avatar };
}

function getLeaderboard(pin) {
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
      streak: p.streak
    }));
}

function getAnswerStats(pin, questionIndex) {
  const room = rooms[pin];
  if (!room) return null;

  const quiz = quizzes[room.quizId];
  const question = quiz.questions[questionIndex];

  if (question.type === 'ordering') {
    let correctCount = 0;
    let totalAnswered = 0;
    Object.values(room.players).forEach(p => {
      const a = p.answers.find(a => a.questionIndex === questionIndex);
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
      total: Object.keys(room.players).length
    };
  }

  if (question.type === 'freetext') {
    const answers = {};
    Object.values(room.players).forEach(p => {
      const a = p.answers.find(a => a.questionIndex === questionIndex);
      if (a) {
        const text = String(a.answerIndex).toLowerCase().trim();
        answers[text] = (answers[text] || 0) + 1;
      }
    });
    return {
      type: 'freetext',
      answers,
      acceptedAnswers: question.acceptedAnswers,
      total: Object.keys(room.players).length
    };
  }

  const choiceCount = question.choices.length;
  const counts = new Array(choiceCount).fill(0);

  Object.values(room.players).forEach(p => {
    const answer = p.answers.find(a => a.questionIndex === questionIndex);
    if (answer) {
      if (question.type === 'multi' && Array.isArray(answer.answerIndex)) {
        answer.answerIndex.forEach(idx => {
          if (idx >= 0 && idx < choiceCount) counts[idx]++;
        });
      } else if (typeof answer.answerIndex === 'number' && answer.answerIndex >= 0 && answer.answerIndex < choiceCount) {
        counts[answer.answerIndex]++;
      }
    }
  });

  const result = { type: question.type, counts, total: Object.keys(room.players).length };
  if (question.type === 'multi') {
    result.correctIndices = question.correctIndices;
  } else {
    result.correctIndex = question.correctIndex;
  }
  return result;
}

function getPlayerList(pin) {
  const room = rooms[pin];
  if (!room) return [];
  return Object.entries(room.players)
    .filter(([, p]) => p.connected)
    .map(([, p]) => ({ nickname: p.nickname, avatar: p.avatar }));
}

function getPlayerCount(pin) {
  const room = rooms[pin];
  if (!room) return 0;
  return Object.values(room.players).filter(p => p.connected).length;
}

function deleteRoom(pin) {
  const room = rooms[pin];
  if (room && room.timer) clearInterval(room.timer);
  delete rooms[pin];
}

// ========== GAME HISTORY ==========

function saveGameHistory(pin) {
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
    startedAt: room.gameStartedAt || new Date().toISOString()
  }).catch(() => {});
}

// ========== PLAYER RECONNECTION ==========

function reconnectPlayer(pin, socketId, fingerprint) {
  const room = rooms[pin];
  if (!room) return { error: 'Room introuvable' };
  if (!fingerprint) return { error: 'Fingerprint manquant' };

  // Find disconnected player with same fingerprint
  for (const [oldSocketId, player] of Object.entries(room.players)) {
    if (player.fingerprint === fingerprint && !player.connected) {
      // Move player data to new socket
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
        score: player.score,
        state: room.state,
        currentQuestionIndex: room.currentQuestionIndex,
        players: getPlayerList(pin)
      };
    }
  }

  return { error: 'Aucune session trouvee' };
}

module.exports = {
  quizzes, rooms,
  createQuiz, createRoom, getRoom, getQuiz,
  reconnectAdmin, addPlayer, addSpectator, kickPlayer, removePlayer,
  reconnectPlayer,
  recordAnswer, addReaction,
  getLeaderboard, getAnswerStats, getPlayerList, getPlayerCount,
  deleteRoom, saveGameHistory
};
