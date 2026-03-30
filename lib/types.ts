export type QuestionType = 'mcq' | 'truefalse' | 'multi' | 'freetext' | 'ordering' | 'slider';

export interface Avatar {
  icon: string;
  color: string;
}

export interface BaseQuestion {
  text: string;
  type: QuestionType;
  timeLimit: number;
  pointsMultiplier: number;
  image: string | null;
  video: string | null;
  explanation: string | null;
  choices: string[];
  _shuffleMap?: number[] | null;
  _shuffledCorrectIndex?: number;
  _shuffledCorrectIndices?: number[];
}

export interface McqQuestion extends BaseQuestion {
  type: 'mcq';
  correctIndex: number;
}

export interface TrueFalseQuestion extends BaseQuestion {
  type: 'truefalse';
  correctIndex: number;
}

export interface MultiQuestion extends BaseQuestion {
  type: 'multi';
  correctIndices: number[];
}

export interface FreetextQuestion extends BaseQuestion {
  type: 'freetext';
  acceptedAnswers: string[];
}

export interface OrderingQuestion extends BaseQuestion {
  type: 'ordering';
  items: string[];
  correctOrder: number[];
}

export interface SliderQuestion extends BaseQuestion {
  type: 'slider';
  sliderMin: number;
  sliderMax: number;
  sliderStep: number;
  correctValue: number;
  tolerance: number;
  unit: string;
}

export type Question =
  | McqQuestion
  | TrueFalseQuestion
  | MultiQuestion
  | FreetextQuestion
  | OrderingQuestion
  | SliderQuestion;

export interface Quiz {
  id: string;
  title: string;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  questions: Question[];
}

export interface PlayerAnswer {
  questionIndex: number;
  answerIndex: number | number[] | string;
  responseTime: number;
  correct: boolean;
  points: number;
}

export interface Player {
  nickname: string;
  score: number;
  answers: PlayerAnswer[];
  connected: boolean;
  streak: number;
  avatar: Avatar;
  fingerprint: string | null;
  playerId: number | null;
}

export interface Spectator {
  nickname: string;
  avatar: Avatar;
  connected: boolean;
}

export interface Reaction {
  socketId: string;
  nickname: string;
  emoji: string;
  avatar: Avatar;
}

export type RoomState = 'lobby' | 'question' | 'time-up' | 'leaderboard' | 'finished';

export interface Room {
  pin: string;
  quizId: string;
  state: RoomState;
  currentQuestionIndex: number;
  players: Record<string, Player>;
  adminSocketId: string;
  adminToken: string;
  questionStartedAt: number | null;
  timer: ReturnType<typeof setInterval> | null;
  answeredCount: number;
  reactions: Record<number, Reaction[]>;
  fingerprints: Set<string>;
  spectators: Record<string, Spectator>;
  gameStartedAt: string | null;
  paused?: boolean;
  _pausedRemaining?: number;
  training?: boolean;
  _trainingTimers?: ReturnType<typeof setTimeout>[];
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  connected: boolean;
  avatar: Avatar;
  streak: number;
  playerId?: number | null;
}

export interface AnswerResult {
  correct: boolean;
  points: number;
  rank?: number;
  totalPlayers?: number;
  totalScore?: number;
  correctIndex?: number;
  correctIndices?: number[];
  correctOrder?: number[];
  acceptedAnswers?: string[];
  correctValue?: number;
  tolerance?: number;
  unit?: string;
}

export interface GameHistoryData {
  quizTitle: string;
  quizId: string;
  pin: string;
  playerCount: number;
  questionCount: number;
  rankings: LeaderboardEntry[];
  startedAt: string;
}

export interface QuestionStats {
  text: string;
  correctPct: number;
  answered: number;
  correct: number;
}

export interface Dashboard {
  perQuestion: QuestionStats[];
  hardestQuestion: QuestionStats | null;
  easiestQuestion: QuestionStats | null;
  avgResponseTime: string | null;
  fastestPlayer: { nickname: string; avgTime: string } | null;
  bestStreak: { nickname: string; count: number } | null;
  totalCorrect: number;
  totalAnswers: number;
  totalCorrectPct: number;
}
