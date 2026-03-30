import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rateLimit as createHttpRateLimit } from 'express-rate-limit';
import http from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import * as store from './lib/store';
import * as game from './lib/game';
import * as db from './lib/db';
import * as redis from './lib/redis';
import log from './lib/logger';

const app = express();
const server = http.createServer(app);

// CORS configuration
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : undefined; // undefined = allow all (dev mode)

const corsOptions: cors.CorsOptions = {
  origin: ALLOWED_ORIGINS || true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6, // 1MB max payload
});

// Resolve root directory (works from both src and dist/)
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'dist', 'client');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// CORS for API routes
app.use(cors(corsOptions));

// HTTP rate limiting
const apiLimiter = createHttpRateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaie dans une minute' },
});
app.use('/api/', apiLimiter);

// JSON body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Serve static files (Vite build output in production, public/ for static assets)
app.use(express.static(CLIENT_DIR));
app.use(express.static(PUBLIC_DIR));

// Routes — serve Vite-built HTML pages
app.get('/', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.get('/admin', async (req, res) => {
  if (adminAuthEnabled) {
    const token = req.query.token as string | undefined;
    if (!token) return res.redirect('/admin/login');
    const user = await db.verifyToken(token);
    if (!user) return res.redirect('/admin/login');
  }
  res.sendFile(path.join(CLIENT_DIR, 'admin.html'));
});

app.get('/admin/history', async (req, res) => {
  if (adminAuthEnabled) {
    const token = req.query.token as string | undefined;
    if (!token) return res.redirect('/admin/login');
    const user = await db.verifyToken(token);
    if (!user) return res.redirect('/admin/login');
  }
  res.sendFile(path.join(CLIENT_DIR, 'history.html'));
});

app.get('/admin/login', (_req, res) => {
  if (!adminAuthEnabled) return res.redirect('/admin');
  res.sendFile(path.join(CLIENT_DIR, 'login.html'));
});

// Public pages
app.get('/leaderboard', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'leaderboard.html'));
});

app.get('/profile', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'profile.html'));
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

// Public: leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const period = (req.query.period as string) || 'all';
  const validPeriods = ['week', 'month', 'all'];
  const safePeriod = validPeriods.includes(period) ? (period as 'week' | 'month' | 'all') : 'all';
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  const { players, total } = await db.getLeaderboard(safePeriod, limit, offset);
  res.json({ players, total, limit, offset });
});

// Public: player profile + achievements
app.get('/api/players/:id/profile', async (req, res) => {
  const playerId = parseInt(String(req.params.id));
  if (isNaN(playerId)) return res.status(400).json({ error: 'ID invalide' });
  const profile = await db.getPlayerProfile(playerId);
  if (!profile) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json(profile);
});

// Public: player game history
app.get('/api/players/:id/games', async (req, res) => {
  const playerId = parseInt(String(req.params.id));
  if (isNaN(playerId)) return res.status(400).json({ error: 'ID invalide' });
  const games = await db.getPlayerGames(playerId);
  res.json(games);
});

// Public: all achievements list
app.get('/api/achievements', async (_req, res) => {
  const achievements = await db.getAchievements();
  res.json(achievements);
});

// Public: global aggregated stats (SQL-based)
app.get('/api/stats', async (_req, res) => {
  const stats = await db.getGlobalStats();
  if (!stats) return res.json({ totalGames: 0, totalPlayers: 0, avgPlayersPerGame: 0, avgQuestionsPerGame: 0, topQuizzes: [] });
  res.json(stats);
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
  log.debug({ socketId: socket.id }, 'Socket connected');

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
    log.info({ email: user.email, socketId: socket.id }, 'Admin authenticated');
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
          socket.emit('admin:error', { message: 'Données invalides' });
          return;
        }

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          if (!q.text) {
            socket.emit('admin:error', { message: `Question ${i + 1} : intitulé manquant` });
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
                message: `Question ${i + 1} : il faut au moins 2 éléments`,
              });
              return;
            }
          } else if (q.type === 'freetext') {
            if (!q.acceptedAnswers || !q.acceptedAnswers.length) {
              socket.emit('admin:error', {
                message: `Question ${i + 1} : réponses acceptées manquantes`,
              });
              return;
            }
          } else if (q.type === 'truefalse') {
            // OK, no choices needed
          } else {
            const validChoices = (q.choices || []).filter((c) => c && c.trim());
            if (validChoices.length < 2) {
              socket.emit('admin:error', {
                message: `Question ${i + 1} : il faut au moins 2 réponses`,
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
      log.info({ pin: room.pin, socketId: socket.id }, 'Room created');
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
      log.info({ pin }, 'Admin reconnected');
    }),
  );

  socket.on('admin:start-game', ({ pin }: { pin: string }) =>
    requireSocketAdmin(socket, () => {
      const room = store.getRoom(pin);
      if (!room || room.adminSocketId !== socket.id) return;
      if (store.getPlayerCount(pin) === 0) return;

      game.startGame(pin, io);
      log.info({ pin }, 'Game started');
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
        log.info({ pin, nickname }, 'Player kicked');
      }
    }),
  );

  // ========== PLAYER REGISTRATION ==========

  socket.on(
    'player:register',
    async ({
      email,
      nickname,
      avatar,
    }: {
      email: string;
      nickname: string;
      avatar: { icon: string; color: string };
    }) => {
      if (!email || !nickname) {
        socket.emit('player:register-error', { message: 'Email et pseudo requis' });
        return;
      }

      const player = await db.registerPlayer(email, nickname, avatar);
      if (!player) {
        socket.emit('player:register-error', { message: "Erreur lors de l'inscription" });
        return;
      }

      socket.emit('player:registered', {
        id: player.id,
        email: player.email,
        nickname: player.nickname,
        avatar: player.avatar,
      });
      log.info({ email: player.email, nickname: player.nickname }, 'Player registered');
    },
  );

  // ========== PLAYER EVENTS ==========

  socket.on(
    'player:join',
    ({
      pin,
      nickname,
      fingerprint,
      avatar: customAvatar,
      playerId,
    }: {
      pin: string;
      nickname: string;
      fingerprint: string | null;
      avatar?: { icon: string; color: string };
      playerId?: number | null;
    }) =>
      rateLimit(socket, 'join', () => {
        const result = store.addPlayer(pin, socket.id, nickname, fingerprint, customAvatar, playerId);
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
          log.info({ nickname: result.nickname, pin }, 'Spectator joined');
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
        log.info({ nickname, pin }, 'Player joined');
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
    log.info({ nickname: result.nickname, pin }, 'Player reconnected');
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
        log.info({ pin: room.pin, nickname }, 'Training started');
      }, 1000);
    },
  );

  // ========== DISCONNECT ==========

  socket.on('disconnect', () => {
    const info = store.removePlayer(socket.id);
    if (info) {
      if (info.isAdmin) {
        io.to(`room:${info.pin}`).emit('game:host-disconnected');
        log.info({ pin: info.pin }, 'Admin disconnected');
      } else {
        const players = store.getPlayerList(info.pin);
        io.to(`room:${info.pin}`).emit('room:player-joined', { players });
        log.debug({ pin: info.pin }, 'Player disconnected');
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  log.info({ port: PORT }, 'Alihoot! server started');
  log.info({ url: `http://localhost:${PORT}` }, 'Players URL');
  log.info({ url: `http://localhost:${PORT}/admin` }, 'Admin URL');
  await db.initTables();
  if (process.env.REDIS_URL) {
    redis.getClient();
    log.info('Redis connected');
  }

  // Keep-alive: self-ping every 14 min to prevent Render free tier from sleeping
  if (process.env.RENDER_EXTERNAL_URL) {
    const keepAliveUrl = `${process.env.RENDER_EXTERNAL_URL}/health`;
    setInterval(
      async () => {
        try {
          await fetch(keepAliveUrl);
          log.debug('Keep-alive ping ok');
        } catch (e) {
          log.warn({ err: e }, 'Keep-alive ping failed');
        }
      },
      14 * 60 * 1000,
    );
    log.info('Keep-alive enabled (every 14 min)');
  }

  // Room garbage collector: clean up stale rooms every 10 min
  store.startRoomGC();
});
