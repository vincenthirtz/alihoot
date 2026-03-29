import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import * as store from './lib/store';
import * as game from './lib/game';
import * as db from './lib/db';

const app = express();
const server = http.createServer(app);

// CORS configuration
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : undefined; // undefined = allow all (dev mode)

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS || true,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e6, // 1MB max payload
});

// Resolve root directory (works from both src and dist/)
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// CORS for API routes (frontend may be on a different domain)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
  } else {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// JSON body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Serve static files
app.use(express.static(PUBLIC_DIR));

// Routes
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/admin', async (req, res) => {
  if (adminAuthEnabled) {
    const token = req.query.token as string | undefined;
    if (!token) return res.redirect('/admin/login');
    const user = await db.verifyToken(token);
    if (!user) return res.redirect('/admin/login');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/admin/history', async (req, res) => {
  if (adminAuthEnabled) {
    const token = req.query.token as string | undefined;
    if (!token) return res.redirect('/admin/login');
    const user = await db.verifyToken(token);
    if (!user) return res.redirect('/admin/login');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'history.html'));
});

app.get('/admin/login', (_req, res) => {
  if (!adminAuthEnabled) return res.redirect('/admin');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// ========== HEALTH CHECK ==========

app.get('/health', (_req, res) => {
  const roomCount = Object.keys(store.rooms).length;
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    rooms: roomCount,
  });
});

// ========== AUTH MIDDLEWARE ==========

const adminAuthEnabled = db.isEnabled();

async function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!adminAuthEnabled) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.slice(7);
  const user = await db.verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Token invalide' });
  }

  next();
}

// Auth info endpoint (tells the client if auth is required)
app.get('/api/auth/config', (_req, res) => {
  res.json({
    required: adminAuthEnabled,
    supabaseUrl: adminAuthEnabled ? process.env.SUPABASE_URL : null,
    supabaseAnonKey: adminAuthEnabled ? process.env.SUPABASE_ANON_KEY : null,
  });
});

// ========== API ROUTES ==========

// Public: read quizzes (needed for training mode too)
app.get('/api/quizzes', async (_req, res) => {
  const quizzes = await db.listQuizzes();
  res.json(quizzes);
});

app.get('/api/quizzes/:id', async (req, res) => {
  const quiz = await db.loadQuiz(String(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'Quiz non trouve' });
  res.json(quiz);
});

// Protected: modify quizzes and view history
app.delete('/api/quizzes/:id', requireAdmin, async (req, res) => {
  await db.deleteQuiz(String(req.params.id));
  res.json({ ok: true });
});

app.get('/api/history', requireAdmin, async (_req, res) => {
  const history = await db.getGameHistory();
  res.json(history);
});

// ========== RATE LIMITING ==========

interface RateBucket {
  count: number;
  resetAt: number;
}

interface RateLimitedSocket extends Socket {
  _rateLimits?: Record<string, RateBucket>;
  _adminAuth?: boolean;
}

type RateLimiterFn = (socket: RateLimitedSocket, eventName: string, cb: () => void) => void;

function createRateLimiter(maxPerWindow: number, windowMs: number): RateLimiterFn {
  return (socket, eventName, cb) => {
    if (!socket._rateLimits) socket._rateLimits = {};
    const now = Date.now();

    if (!socket._rateLimits[eventName]) {
      socket._rateLimits[eventName] = { count: 0, resetAt: now + windowMs };
    }

    const bucket = socket._rateLimits[eventName];
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count++;
    if (bucket.count > maxPerWindow) {
      socket.emit('error:rate-limit', { message: 'Trop de requetes, ralentis !' });
      return;
    }

    cb();
  };
}

const rateLimiters: Record<string, RateLimiterFn> = {
  answer: createRateLimiter(5, 10000),
  react: createRateLimiter(10, 10000),
  join: createRateLimiter(5, 30000),
  default: createRateLimiter(20, 10000),
};

function rateLimit(socket: RateLimitedSocket, eventName: string, cb: () => void): void {
  const limiter = rateLimiters[eventName] || rateLimiters.default;
  limiter(socket, eventName, cb);
}

// ========== SOCKET AUTH ==========

function requireSocketAdmin(socket: RateLimitedSocket, cb: () => void): void {
  if (!adminAuthEnabled || socket._adminAuth) {
    cb();
    return;
  }
  socket.emit('admin:error', { message: 'Authentification requise' });
}

// Socket.IO
io.on('connection', (socket: RateLimitedSocket) => {
  console.log(`Connected: ${socket.id}`);

  // Admin authentication via token
  socket.on('admin:auth', async ({ token }: { token: string }) => {
    if (!adminAuthEnabled) {
      socket._adminAuth = true;
      socket.emit('admin:auth-ok');
      return;
    }

    const user = await db.verifyToken(token);
    if (!user) {
      socket.emit('admin:auth-error', { message: 'Token invalide' });
      return;
    }

    socket._adminAuth = true;
    socket.emit('admin:auth-ok');
    console.log(`Admin authenticated: ${user.email} (${socket.id})`);
  });

  // ========== ADMIN EVENTS ==========

  socket.on(
    'admin:create-quiz',
    ({
      title,
      questions,
      shuffleQuestions,
      shuffleChoices,
    }: {
      title: string;
      questions: Array<{
        text: string;
        type?: string;
        choices?: string[];
        items?: string[];
        acceptedAnswers?: string[];
        video?: string;
        sliderMin?: number;
        sliderMax?: number;
        sliderStep?: number;
        correctValue?: number;
        tolerance?: number;
        unit?: string;
      }>;
      shuffleQuestions?: boolean;
      shuffleChoices?: boolean;
    }) =>
      requireSocketAdmin(socket, () => {
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
          if (q.type === 'slider') {
            if (q.correctValue == null) {
              socket.emit('admin:error', {
                message: `Question ${i + 1} : valeur correcte manquante`,
              });
              return;
            }
          } else if (q.type === 'ordering') {
            const validItems = (q.items || []).filter((item) => item && item.trim());
            if (validItems.length < 2) {
              socket.emit('admin:error', {
                message: `Question ${i + 1} : il faut au moins 2 elements`,
              });
              return;
            }
          } else if (q.type === 'freetext') {
            if (!q.acceptedAnswers || !q.acceptedAnswers.length) {
              socket.emit('admin:error', {
                message: `Question ${i + 1} : reponses acceptees manquantes`,
              });
              return;
            }
          } else if (q.type === 'truefalse') {
            // OK, no choices needed
          } else {
            const validChoices = (q.choices || []).filter((c) => c && c.trim());
            if (validChoices.length < 2) {
              socket.emit('admin:error', {
                message: `Question ${i + 1} : il faut au moins 2 reponses`,
              });
              return;
            }
          }
        }

        const result = store.createQuiz(title, questions, {
          shuffleQuestions: !!shuffleQuestions,
          shuffleChoices: !!shuffleChoices,
        });
        if (typeof result === 'object' && 'error' in result) {
          socket.emit('admin:error', { message: result.error });
          return;
        }
        socket.emit('admin:quiz-created', { quizId: result });
      }),
  );

  socket.on('admin:create-room', ({ quizId }: { quizId: string }) =>
    requireSocketAdmin(socket, () => {
      const room = store.createRoom(quizId, socket.id);
      if (!room) {
        socket.emit('admin:error', { message: 'Quiz introuvable' });
        return;
      }
      socket.join(`room:${room.pin}`);
      socket.emit('admin:room-created', { pin: room.pin, adminToken: room.adminToken });
      console.log(`Room created: ${room.pin} by ${socket.id}`);
    }),
  );

  socket.on('admin:reconnect', ({ pin, adminToken }: { pin: string; adminToken: string }) =>
    requireSocketAdmin(socket, () => {
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
        quiz: store.getQuiz(room.quizId),
      });
      console.log(`Admin reconnected to room ${pin}`);
    }),
  );

  socket.on('admin:start-game', ({ pin }: { pin: string }) =>
    requireSocketAdmin(socket, () => {
      const room = store.getRoom(pin);
      if (!room || room.adminSocketId !== socket.id) return;
      if (store.getPlayerCount(pin) === 0) return;

      game.startGame(pin, io);
      console.log(`Game started: ${pin}`);
    }),
  );

  socket.on('admin:show-leaderboard', ({ pin }: { pin: string }) =>
    requireSocketAdmin(socket, () => {
      const room = store.getRoom(pin);
      if (!room || room.adminSocketId !== socket.id) return;
      game.showLeaderboard(pin, io);
    }),
  );

  socket.on('admin:next-question', ({ pin }: { pin: string }) =>
    requireSocketAdmin(socket, () => {
      const room = store.getRoom(pin);
      if (!room || room.adminSocketId !== socket.id) return;
      game.nextQuestion(pin, io);
    }),
  );

  socket.on('admin:toggle-pause', ({ pin }: { pin: string }) =>
    requireSocketAdmin(socket, () => {
      const room = store.getRoom(pin);
      if (!room || room.adminSocketId !== socket.id) return;
      game.togglePause(pin, io);
    }),
  );

  socket.on('admin:kick', ({ pin, nickname }: { pin: string; nickname: string }) =>
    requireSocketAdmin(socket, () => {
      const result = store.kickPlayer(pin, socket.id, nickname);
      if (result) {
        io.to(result.socketId).emit('player:kicked');
        io.to(`room:${pin}`).emit('room:player-joined', { players: result.players });
        console.log(`Kicked ${nickname} from room ${pin}`);
      }
    }),
  );

  // ========== PLAYER EVENTS ==========

  socket.on(
    'player:join',
    ({
      pin,
      nickname,
      fingerprint,
      avatar: customAvatar,
    }: {
      pin: string;
      nickname: string;
      fingerprint: string | null;
      avatar?: { icon: string; color: string };
    }) =>
      rateLimit(socket, 'join', () => {
        const result = store.addPlayer(pin, socket.id, nickname, fingerprint, customAvatar);
        if (result.error) {
          socket.emit('player:error', { message: result.error });
          return;
        }

        socket.join(`room:${pin}`);

        if (result.spectator) {
          socket.emit('player:joined-spectator', {
            pin,
            nickname: result.nickname,
            avatar: result.avatar,
            state: result.state,
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
          state: result.state,
        });
        io.to(`room:${pin}`).emit('room:player-joined', { players: result.players });
        console.log(`Player joined: ${nickname} -> room ${pin}`);
      }),
  );

  socket.on('player:reconnect', ({ pin, fingerprint }: { pin: string; fingerprint: string }) => {
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
      state: result.state,
    });
    io.to(`room:${pin}`).emit('room:player-joined', {
      players: store.getPlayerList(pin),
    });
    console.log(`Player reconnected: ${result.nickname} -> room ${pin}`);
  });

  socket.on(
    'player:answer',
    ({
      pin,
      questionIndex,
      answerIndex,
    }: {
      pin: string;
      questionIndex: number;
      answerIndex: number | number[] | string;
    }) =>
      rateLimit(socket, 'answer', () => {
        game.handleAnswer(pin, socket.id, questionIndex, answerIndex, io);
      }),
  );

  socket.on('player:react', ({ pin, emoji }: { pin: string; emoji: string }) =>
    rateLimit(socket, 'react', () => {
      const reaction = store.addReaction(pin, socket.id, emoji);
      if (reaction) {
        io.to(`room:${pin}`).emit('game:reaction', reaction);
      }
    }),
  );

  // ========== TRAINING MODE ==========

  socket.on(
    'training:start',
    async ({
      quizId,
      nickname,
      avatar,
    }: {
      quizId: string;
      nickname: string;
      avatar: { icon: string; color: string };
    }) => {
      const quiz = await store.ensureQuizLoaded(quizId);
      if (!quiz) {
        socket.emit('player:error', { message: 'Quiz introuvable' });
        return;
      }

      const room = store.createTrainingRoom(quizId, socket.id, nickname, avatar);
      if (!room) {
        socket.emit('player:error', { message: 'Impossible de creer la session' });
        return;
      }

      socket.join(`room:${room.pin}`);
      socket.emit('training:ready', {
        pin: room.pin,
        nickname,
        avatar,
        quiz: { title: quiz.title, questionCount: quiz.questions.length },
      });

      // Auto-start after brief delay
      setTimeout(() => {
        game.startGame(room.pin, io);
        console.log(`Training started: ${room.pin} by ${nickname}`);
      }, 1000);
    },
  );

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
