require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const store = require('./lib/store');
const game = require('./lib/game');
const db = require('./lib/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// JSON body parser for API routes
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

// ========== API ROUTES ==========

// List saved quizzes from Supabase
app.get('/api/quizzes', async (req, res) => {
  const quizzes = await db.listQuizzes();
  res.json(quizzes);
});

// Load a specific quiz from Supabase
app.get('/api/quizzes/:id', async (req, res) => {
  const quiz = await db.loadQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz non trouve' });
  res.json(quiz);
});

// Delete a quiz from Supabase
app.delete('/api/quizzes/:id', async (req, res) => {
  await db.deleteQuiz(req.params.id);
  res.json({ ok: true });
});

// Game history
app.get('/api/history', async (req, res) => {
  const history = await db.getGameHistory();
  res.json(history);
});

// Socket.IO
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // ========== ADMIN EVENTS ==========

  socket.on('admin:create-quiz', ({ title, questions, shuffleQuestions, shuffleChoices }) => {
    if (!title || !questions || !questions.length) {
      socket.emit('admin:error', { message: 'Donnees invalides' });
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text) {
        socket.emit('admin:error', { message: `Question ${i + 1} : intitule manquant` });
        return;
      }
      if (q.type === 'ordering') {
        const validItems = (q.items || []).filter(item => item && item.trim());
        if (validItems.length < 2) {
          socket.emit('admin:error', { message: `Question ${i + 1} : il faut au moins 2 elements` });
          return;
        }
      } else if (q.type === 'freetext') {
        if (!q.acceptedAnswers || !q.acceptedAnswers.length) {
          socket.emit('admin:error', { message: `Question ${i + 1} : reponses acceptees manquantes` });
          return;
        }
      } else if (q.type === 'truefalse') {
        // OK, no choices needed
      } else {
        const validChoices = (q.choices || []).filter(c => c && c.trim());
        if (validChoices.length < 2) {
          socket.emit('admin:error', { message: `Question ${i + 1} : il faut au moins 2 reponses` });
          return;
        }
      }
    }

    const quizId = store.createQuiz(title, questions, { shuffleQuestions: !!shuffleQuestions, shuffleChoices: !!shuffleChoices });
    socket.emit('admin:quiz-created', { quizId });
  });

  socket.on('admin:create-room', ({ quizId }) => {
    const room = store.createRoom(quizId, socket.id);
    if (!room) {
      socket.emit('admin:error', { message: 'Quiz introuvable' });
      return;
    }
    socket.join(`room:${room.pin}`);
    socket.emit('admin:room-created', { pin: room.pin, adminToken: room.adminToken });
    console.log(`Room created: ${room.pin} by ${socket.id}`);
  });

  socket.on('admin:reconnect', ({ pin, adminToken }) => {
    const room = store.reconnectAdmin(pin, adminToken, socket.id);
    if (!room) {
      socket.emit('admin:error', { message: 'Reconnexion impossible' });
      return;
    }
    socket.join(`room:${pin}`);
    socket.emit('admin:reconnected', {
      pin,
      state: room.state,
      players: store.getPlayerList(pin),
      currentQuestionIndex: room.currentQuestionIndex,
      quiz: store.getQuiz(room.quizId)
    });
    console.log(`Admin reconnected to room ${pin}`);
  });

  socket.on('admin:start-game', ({ pin }) => {
    const room = store.getRoom(pin);
    if (!room || room.adminSocketId !== socket.id) return;
    if (store.getPlayerCount(pin) === 0) return;

    game.startGame(pin, io);
    console.log(`Game started: ${pin}`);
  });

  socket.on('admin:show-leaderboard', ({ pin }) => {
    const room = store.getRoom(pin);
    if (!room || room.adminSocketId !== socket.id) return;
    game.showLeaderboard(pin, io);
  });

  socket.on('admin:next-question', ({ pin }) => {
    const room = store.getRoom(pin);
    if (!room || room.adminSocketId !== socket.id) return;
    game.nextQuestion(pin, io);
  });

  socket.on('admin:toggle-pause', ({ pin }) => {
    const room = store.getRoom(pin);
    if (!room || room.adminSocketId !== socket.id) return;
    game.togglePause(pin, io);
  });

  socket.on('admin:kick', ({ pin, nickname }) => {
    const result = store.kickPlayer(pin, socket.id, nickname);
    if (result) {
      io.to(result.socketId).emit('player:kicked');
      io.to(`room:${pin}`).emit('room:player-joined', { players: result.players });
      console.log(`Kicked ${nickname} from room ${pin}`);
    }
  });

  // ========== PLAYER EVENTS ==========

  socket.on('player:join', ({ pin, nickname, fingerprint, avatar: customAvatar }) => {
    const result = store.addPlayer(pin, socket.id, nickname, fingerprint, customAvatar);
    if (result.error) {
      socket.emit('player:error', { message: result.error });
      return;
    }

    socket.join(`room:${pin}`);

    // Spectator mode
    if (result.spectator) {
      socket.emit('player:joined-spectator', {
        pin,
        nickname: result.nickname,
        avatar: result.avatar,
        state: result.state
      });
      console.log(`Spectator joined: ${result.nickname} -> room ${pin}`);
      return;
    }

    socket.emit('player:joined', {
      pin,
      nickname: nickname.trim(),
      players: result.players,
      avatar: result.avatar,
      success: result.success,
      state: result.state
    });
    io.to(`room:${pin}`).emit('room:player-joined', { players: result.players });
    console.log(`Player joined: ${nickname} -> room ${pin}`);
  });

  socket.on('player:reconnect', ({ pin, fingerprint }) => {
    const result = store.reconnectPlayer(pin, socket.id, fingerprint);
    if (result.error) {
      socket.emit('player:error', { message: result.error });
      return;
    }

    socket.join(`room:${pin}`);
    socket.emit('player:reconnected', {
      pin,
      nickname: result.nickname,
      avatar: result.avatar,
      score: result.score,
      state: result.state,
      currentQuestionIndex: result.currentQuestionIndex,
      players: result.players
    });
    io.to(`room:${pin}`).emit('room:player-joined', { players: result.players });
    console.log(`Player reconnected: ${result.nickname} -> room ${pin}`);
  });

  socket.on('player:answer', ({ pin, questionIndex, answerIndex }) => {
    game.handleAnswer(pin, socket.id, questionIndex, answerIndex, io);
  });

  socket.on('player:react', ({ pin, emoji }) => {
    const reaction = store.addReaction(pin, socket.id, emoji);
    if (reaction) {
      io.to(`room:${pin}`).emit('game:reaction', reaction);
    }
  });

  // ========== DISCONNECT ==========

  socket.on('disconnect', () => {
    const info = store.removePlayer(socket.id);
    if (info) {
      if (info.isAdmin) {
        io.to(`room:${info.pin}`).emit('game:host-disconnected');
        console.log(`Admin disconnected from room ${info.pin}`);
      } else {
        const players = store.getPlayerList(info.pin);
        io.to(`room:${info.pin}`).emit('room:player-joined', { players });
        console.log(`Player disconnected from room ${info.pin}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`\n  🎮 Alihoot! est lance sur http://localhost:${PORT}`);
  console.log(`  📱 Joueurs : http://localhost:${PORT}`);
  console.log(`  👑 Admin   : http://localhost:${PORT}/admin`);
  console.log(`  📊 Historique : http://localhost:${PORT}/admin/history`);
  await db.initTables();
  console.log('');
});
