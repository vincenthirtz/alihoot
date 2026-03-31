import { io } from 'socket.io-client';
import { AudioSystem } from './audio.js';
import { startConfetti } from './confetti.js';
import { TIMING, VIBRATION, PODIUM, ANIMATION, VALIDATION } from './config.js';

const BACKEND_URL = import.meta.env.PROD ? 'https://alihoot.onrender.com' : '';
const socket = io(BACKEND_URL || undefined);

// State
let currentPin = null;
let currentNickname = null;
let currentAvatar = null;
let currentQuestionIndex = -1;
let currentQuestionType = 'mcq';
let answered = false;
let timerDuration = 20;
let selectedMulti = [];
let registeredPlayer = JSON.parse(localStorage.getItem('alihoot-player') || 'null');

// Fingerprint for anti-cheat
const fingerprint = (() => {
  let fp = sessionStorage.getItem('alihoot-fp');
  if (!fp) {
    fp = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('alihoot-fp', fp);
  }
  return fp;
})();

let isTraining = false;

// Decode HTML entities (&#039; → ', &amp; → &, etc.)
const _decodeEl = document.createElement('textarea');
function decodeHTML(str) {
  _decodeEl.innerHTML = str;
  return _decodeEl.value;
}

// YouTube URL parser
function extractYouTubeId(url) {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([a-zA-Z0-9_-]{11})/,
  );
  return match ? match[1] : null;
}

// DOM
const screens = {
  register: document.getElementById('register-screen'),
  join: document.getElementById('join-screen'),
  training: document.getElementById('training-screen'),
  lobby: document.getElementById('lobby-screen'),
  question: document.getElementById('question-screen'),
  waiting: document.getElementById('waiting-screen'),
  result: document.getElementById('result-screen'),
  leaderboard: document.getElementById('leaderboard-screen'),
  podium: document.getElementById('podium-screen'),
};

let _transitioning = false;

function showScreen(name) {
  const current = Object.values(screens).find((s) => s.classList.contains('active'));
  const next = screens[name];
  if (!next || current === next) return;

  if (current && !_transitioning) {
    _transitioning = true;
    current.classList.add('screen-exit');
    current.addEventListener(
      'animationend',
      () => {
        current.classList.remove('active', 'screen-exit');
        next.classList.add('active');
        _transitioning = false;
        // Focus management for accessibility
        const focusTarget = next.querySelector(
          'input:not([style*="display:none"]):not([style*="display: none"]), button:not([style*="display:none"]):not([style*="display: none"])',
        );
        if (focusTarget) focusTarget.focus({ preventScroll: true });
      },
      { once: true },
    );
  } else {
    if (current) current.classList.remove('active', 'screen-exit');
    next.classList.add('active');
    _transitioning = false;
  }

  if (name === 'waiting' && isTraining) {
    document.getElementById('waiting-subtext').textContent = 'Résultats dans quelques secondes...';
  }
}

// ========== HAPTIC FEEDBACK ==========

function vibrate(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

// Sound toggle
let soundOn = true;
document.getElementById('toggle-sound').addEventListener('click', () => {
  soundOn = !soundOn;
  AudioSystem.toggle(soundOn);
  const btn = document.getElementById('toggle-sound');
  btn.textContent = soundOn ? '🔊' : '🔇';
  btn.classList.toggle('off', !soundOn);
});

// Theme toggle
document.getElementById('toggle-theme').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  document.getElementById('toggle-theme').textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('alihoot-theme', isDark ? 'dark' : 'light');
});

// Restore theme
if (localStorage.getItem('alihoot-theme') === 'dark') {
  document.body.classList.add('dark');
  document.getElementById('toggle-theme').textContent = '☀️';
}

// ========== LOADING OVERLAY ==========
const loadingOverlay = document.getElementById('loading-overlay');
const loadingTextEl = document.getElementById('loading-text');
let _loadingStart = Date.now();
let _loadingInterval = setInterval(() => {
  const elapsed = Math.floor((Date.now() - _loadingStart) / 1000);
  if (loadingTextEl && elapsed > TIMING.LOADING_SLOW_THRESHOLD_S) {
    loadingTextEl.textContent = `Connexion au serveur... (${elapsed}s)`;
  }
}, TIMING.LOADING_CHECK_INTERVAL_MS);

function hideLoadingOverlay() {
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  clearInterval(_loadingInterval);
}

// ========== CONNECTION INDICATOR ==========

const connectionIndicator = document.getElementById('connection-indicator');
const connectionText = document.getElementById('connection-text');

function setConnectionStatus(status) {
  connectionIndicator.className = 'connection-indicator ' + status;
  if (status === 'connected') {
    connectionText.textContent = 'Connecté';
    connectionIndicator.classList.add('auto-hide');
    hideLoadingOverlay();
    clearInterval(_loadingInterval);
  } else if (status === 'reconnecting') {
    connectionText.textContent = 'Reconnexion…';
    connectionIndicator.classList.remove('auto-hide');
  } else {
    connectionText.textContent = 'Déconnecté';
    connectionIndicator.classList.remove('auto-hide');
  }
}

socket.on('connect', () => setConnectionStatus('connected'));
socket.on('disconnect', () => {
  setConnectionStatus('disconnected');
  joinBtn.disabled = false;
  const regBtn = document.getElementById('register-btn');
  if (regBtn) regBtn.disabled = false;
});
socket.io.on('reconnect_attempt', () => setConnectionStatus('reconnecting'));
socket.io.on('reconnect', () => {
  setConnectionStatus('connected');
  // Re-join room if we were in a game
  if (currentPin) {
    socket.emit('player:reconnect', { pin: currentPin, fingerprint });
  }
});

// Audio events
socket.on('audio:play', ({ sound }) => AudioSystem.play(sound));

// ========== JOIN ==========

const pinInput = document.getElementById('pin-input');
const nicknameInput = document.getElementById('nickname-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');

// Auto-fill PIN from URL
const urlPin = new URLSearchParams(window.location.search).get('pin');
if (urlPin) pinInput.value = urlPin;

// ========== AVATAR PICKER ==========

const AVATAR_ICONS = [
  '🐱',
  '🐶',
  '🦊',
  '🐸',
  '🐵',
  '🦁',
  '🐼',
  '🐨',
  '🐯',
  '🦄',
  '🐙',
  '🦋',
  '🐢',
  '🦖',
  '🐳',
  '🦩',
  '🦀',
  '🐝',
  '🦜',
  '🐺',
];
const AVATAR_COLORS = [
  '#e21b3c',
  '#1368ce',
  '#d89e00',
  '#26890c',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#8e44ad',
];

let chosenIcon = AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)];
let chosenColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

function renderAvatarPicker() {
  const preview = document.getElementById('avatar-preview');
  preview.textContent = chosenIcon;
  preview.style.background = chosenColor;

  const emojiGrid = document.getElementById('avatar-emoji-grid');
  emojiGrid.innerHTML = AVATAR_ICONS.map(
    (icon) =>
      `<button class="avatar-pick-btn${icon === chosenIcon ? ' active' : ''}" onclick="pickIcon(this, '${icon}')">${icon}</button>`,
  ).join('');

  const colorGrid = document.getElementById('avatar-color-grid');
  colorGrid.innerHTML = AVATAR_COLORS.map(
    (color) =>
      `<button class="avatar-color-btn${color === chosenColor ? ' active' : ''}" style="background:${color}" onclick="pickColor(this, '${color}')"></button>`,
  ).join('');
}

window.pickIcon = function (btn, icon) {
  chosenIcon = icon;
  document.querySelectorAll('.avatar-pick-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('avatar-preview').textContent = icon;
};

window.pickColor = function (btn, color) {
  chosenColor = color;
  document.querySelectorAll('.avatar-color-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('avatar-preview').style.background = color;
};

renderAvatarPicker();

// ========== REGISTRATION ==========

function renderRegisterAvatarPicker() {
  const preview = document.getElementById('register-avatar-preview');
  preview.textContent = chosenIcon;
  preview.style.background = chosenColor;

  const emojiGrid = document.getElementById('register-emoji-grid');
  emojiGrid.innerHTML = AVATAR_ICONS.map(
    (icon) =>
      `<button class="avatar-pick-btn${icon === chosenIcon ? ' active' : ''}" data-reg-icon="${icon}">${icon}</button>`,
  ).join('');
  emojiGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reg-icon]');
    if (!btn) return;
    chosenIcon = btn.dataset.regIcon;
    emojiGrid.querySelectorAll('.avatar-pick-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    preview.textContent = chosenIcon;
    // Sync join screen picker
    renderAvatarPicker();
  });

  const colorGrid = document.getElementById('register-color-grid');
  colorGrid.innerHTML = AVATAR_COLORS.map(
    (color) =>
      `<button class="avatar-color-btn${color === chosenColor ? ' active' : ''}" style="background:${color}" data-reg-color="${color}"></button>`,
  ).join('');
  colorGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reg-color]');
    if (!btn) return;
    chosenColor = btn.dataset.regColor;
    colorGrid.querySelectorAll('.avatar-color-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    preview.style.background = chosenColor;
    renderAvatarPicker();
  });
}

// If already registered, skip to join screen
if (registeredPlayer) {
  chosenIcon = registeredPlayer.avatar?.icon || chosenIcon;
  chosenColor = registeredPlayer.avatar?.color || chosenColor;
  currentNickname = registeredPlayer.nickname;
  renderAvatarPicker();
  // Switch active screen: hide register, show join
  screens.register.classList.remove('active');
  screens.join.classList.add('active');
  // Pre-fill nickname
  document.getElementById('nickname-input').value = registeredPlayer.nickname;
} else {
  renderRegisterAvatarPicker();
}

const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');
const registerEmail = document.getElementById('register-email');
const registerNickname = document.getElementById('register-nickname');

registerBtn.addEventListener('click', () => {
  const email = registerEmail.value.trim().toLowerCase();
  const nickname = registerNickname.value.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    registerError.textContent = 'Entre une adresse email valide';
    return;
  }
  if (!nickname || nickname.length < 1) {
    registerError.textContent = 'Entre un pseudo';
    return;
  }

  if (!socket.connected) {
    registerError.textContent = 'Pas de connexion au serveur';
    return;
  }
  registerError.textContent = '';
  registerBtn.disabled = true;

  socket.emit('player:register', {
    email,
    nickname,
    avatar: { icon: chosenIcon, color: chosenColor },
  });
});

registerEmail.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerNickname.focus();
});
registerNickname.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') registerBtn.click();
});

socket.on('player:registered', (data) => {
  registeredPlayer = data;
  localStorage.setItem('alihoot-player', JSON.stringify(data));
  currentNickname = data.nickname;
  document.getElementById('nickname-input').value = data.nickname;
  renderAvatarPicker();
  registerBtn.disabled = false;
  showScreen('join');
});

socket.on('player:register-error', ({ message }) => {
  registerError.textContent = message;
  registerBtn.disabled = false;
});

// Skip registration — play without an account
document.getElementById('skip-register-btn').addEventListener('click', () => {
  const nickname = registerNickname.value.trim();
  if (!nickname) {
    registerError.textContent = 'Entre au moins un pseudo';
    return;
  }
  currentNickname = nickname;
  document.getElementById('nickname-input').value = nickname;
  renderAvatarPicker();
  showScreen('join');
});

// ========== JOIN ==========

joinBtn.addEventListener('click', () => {
  const pin = pinInput.value.trim();
  const nickname = nicknameInput.value.trim();
  if (!pin || pin.length < VALIDATION.MIN_PIN_LENGTH) {
    joinError.textContent = 'Entre un code PIN a 6 chiffres';
    return;
  }
  if (!nickname) {
    joinError.textContent = 'Entre un pseudo';
    return;
  }
  if (!socket.connected) {
    joinError.textContent = 'Pas de connexion au serveur';
    return;
  }
  joinError.textContent = '';
  joinBtn.disabled = true;
  socket.emit('player:join', {
    pin,
    nickname,
    fingerprint,
    avatar: { icon: chosenIcon, color: chosenColor },
    playerId: registeredPlayer ? registeredPlayer.id : null,
  });
});

pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') nicknameInput.focus();
});
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

socket.on('player:joined', ({ pin, nickname, players, avatar, success, state }) => {
  currentPin = pin;
  currentNickname = nickname || currentNickname;
  currentAvatar = avatar || currentAvatar;

  // Save session for reconnection
  sessionStorage.setItem('alihoot-session', JSON.stringify({ pin, nickname: currentNickname }));

  // If this was a mid-game reconnection
  if (success && state && state !== 'lobby') {
    document.getElementById('lobby-avatar').textContent = currentAvatar?.icon || '👤';
    document.getElementById('lobby-name').textContent = currentNickname;
    showScreen('waiting');
    return;
  }

  document.getElementById('lobby-avatar').textContent = avatar?.icon || '👤';
  document.getElementById('lobby-name').textContent = nickname;
  renderLobbyPlayers(players);
  showScreen('lobby');
});

// ========== SPECTATOR MODE ==========

let isSpectator = false;

socket.on('player:joined-spectator', ({ pin, nickname, avatar, state }) => {
  currentPin = pin;
  currentNickname = nickname;
  currentAvatar = avatar;
  isSpectator = true;

  document.getElementById('lobby-avatar').textContent = avatar?.icon || '👤';
  document.getElementById('lobby-name').textContent = nickname;
  document.getElementById('spectator-badge').style.display = 'inline-block';
  showScreen('lobby');
});

socket.on('player:error', ({ message }) => {
  joinError.textContent = message;
  joinBtn.disabled = false;
});

socket.on('error:rate-limit', ({ message }) => {
  joinError.textContent = message || 'Trop de requêtes, ralentis !';
  joinBtn.disabled = false;
});

socket.on('room:player-joined', ({ players }) => {
  renderLobbyPlayers(players);
});

function renderLobbyPlayers(players) {
  document.getElementById('lobby-players').innerHTML = players
    .map(
      (p) =>
        `<div class="player-chip"><span class="chip-avatar">${p.avatar?.icon || '👤'}</span>${p.nickname}</div>`,
    )
    .join('');
}

// ========== AUTO RECONNECT ==========

(function tryReconnect() {
  try {
    const data = JSON.parse(sessionStorage.getItem('alihoot-session') || 'null');
    if (data && data.pin) {
      socket.emit('player:reconnect', { pin: data.pin, fingerprint });
    }
  } catch {}
})();

socket.on(
  'player:reconnected',
  ({ pin, nickname, avatar, score, state, currentQuestionIndex, players }) => {
    currentPin = pin;
    currentNickname = nickname;
    currentAvatar = avatar;

    sessionStorage.setItem('alihoot-session', JSON.stringify({ pin, nickname }));

    if (state === 'lobby') {
      document.getElementById('lobby-avatar').textContent = avatar?.icon || '👤';
      document.getElementById('lobby-name').textContent = nickname;
      renderLobbyPlayers(players);
      showScreen('lobby');
    } else if (state === 'finished') {
      showScreen('podium');
    } else {
      // Game in progress — show waiting screen
      showScreen('waiting');
    }

    joinBtn.disabled = false;
  },
);

// ========== KICKED ==========

socket.on('player:kicked', () => {
  sessionStorage.removeItem('alihoot-session');
  document.getElementById('kicked-overlay').style.display = 'flex';
  setTimeout(() => window.location.reload(), TIMING.KICKED_RELOAD_DELAY_MS);
});

// ========== COUNTDOWN ==========

socket.on('game:starting', ({ countdown }) => {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');
  overlay.style.display = 'flex';
  let count = countdown;
  numEl.textContent = count;

  vibrate(VIBRATION.COUNTDOWN_INITIAL);
  const interval = setInterval(() => {
    count--;
    AudioSystem.play('countdown');
    vibrate(VIBRATION.COUNTDOWN_TICK);
    if (count <= 0) {
      clearInterval(interval);
      overlay.style.display = 'none';
    } else {
      numEl.textContent = count;
      numEl.style.animation = 'none';
      numEl.offsetHeight;
      numEl.style.animation = 'countPop 0.8s ease';
    }
  }, 1000);
});

// ========== QUESTION ==========

const barColors = ['btn-red', 'btn-blue', 'btn-yellow', 'btn-green', 'btn-orange', 'btn-teal', 'btn-pink', 'btn-indigo'];
const shapeIcons = ['1', '2', '3', '4', '5', '6', '7', '8'];

let currentOrderingMap = null;

socket.on(
  'game:question',
  ({
    questionIndex,
    text,
    choices,
    timeLimit,
    total,
    type,
    image,
    video,
    pointsMultiplier,
    orderingItems,
    orderingMap,
    slider,
  }) => {
    currentQuestionIndex = questionIndex;
    currentQuestionType = type || 'mcq';
    answered = false;
    timerDuration = timeLimit;
    selectedMulti = [];
    currentOrderingMap = orderingMap || null;

    const multiplierBadge =
      pointsMultiplier && pointsMultiplier > 1
        ? ` <span class="multiplier-badge">x${pointsMultiplier}</span>`
        : '';
    document.getElementById('q-counter').innerHTML =
      `Question ${questionIndex + 1} / ${total}${multiplierBadge}`;
    document.getElementById('q-text').textContent = decodeHTML(text);
    document.getElementById('timer-display').textContent = timeLimit;

    // Progress bar
    const progressBar = document.getElementById('q-progress-bar');
    progressBar.innerHTML = Array.from({ length: total }, (_, i) => {
      const cls = i < questionIndex ? 'done' : i === questionIndex ? 'current' : '';
      return `<div class="progress-dot ${cls}"></div>`;
    }).join('');

    // Image
    const imgEl = document.getElementById('q-image');
    const decodedImage = image ? decodeHTML(image) : null;
    if (decodedImage) {
      imgEl.src = decodedImage;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }

    // Video
    const videoContainer = document.getElementById('q-video');
    const decodedVideo = video ? decodeHTML(video) : null;
    if (decodedVideo) {
      const ytId = extractYouTubeId(decodedVideo);
      if (ytId) {
        videoContainer.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1" frameborder="0" allowfullscreen></iframe>`;
      } else {
        videoContainer.innerHTML = `<video src="${decodedVideo}" controls playsinline preload="metadata"></video>`;
      }
      videoContainer.style.display = 'block';
    } else {
      videoContainer.innerHTML = '';
      videoContainer.style.display = 'none';
    }

    // Timer bar
    const timerBar = document.getElementById('timer-bar');
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
    timerBar.offsetHeight;
    timerBar.style.transition = `width ${timeLimit}s linear`;
    timerBar.style.width = '0%';

    // Hide all answer modes
    const grid = document.getElementById('answer-grid');
    const freetextInput = document.getElementById('freetext-input');
    const freetextSubmit = document.getElementById('freetext-submit');
    const multiHint = document.getElementById('multi-hint');
    const multiSubmit = document.getElementById('multi-submit');

    const orderingContainer = document.getElementById('ordering-container');
    const orderingSubmit = document.getElementById('ordering-submit');

    const sliderContainer = document.getElementById('slider-container');
    const sliderSubmit = document.getElementById('slider-submit');

    // Clean up previous reveal elements
    document
      .querySelectorAll(
        '.freetext-correct-reveal, .slider-correct-reveal, .ordering-correct-reveal',
      )
      .forEach((el) => el.remove());

    // Reset answer counter
    const answerCountEl = document.getElementById('player-answer-count');
    if (answerCountEl) answerCountEl.style.display = 'none';

    freetextInput.style.display = 'none';
    freetextSubmit.style.display = 'none';
    multiHint.style.display = 'none';
    multiSubmit.style.display = 'none';
    orderingContainer.style.display = 'none';
    orderingSubmit.style.display = 'none';
    sliderContainer.style.display = 'none';
    sliderSubmit.style.display = 'none';

    if (type === 'slider') {
      grid.style.display = 'none';
      sliderContainer.style.display = 'block';
      sliderSubmit.style.display = 'block';
      sliderSubmit.disabled = false;
      const s = slider || {};
      const mid = (s.sliderMin + s.sliderMax) / 2;
      const unit = s.unit || '';
      sliderContainer.innerHTML = `
        <div class="slider-labels"><span>${s.sliderMin}${unit}</span><span>${s.sliderMax}${unit}</span></div>
        <input type="range" class="slider-input" id="player-slider" min="${s.sliderMin}" max="${s.sliderMax}" step="${s.sliderStep}" value="${mid}">
        <div class="slider-value" id="slider-value-display">${mid}${unit}</div>
      `;
      const sliderInput = document.getElementById('player-slider');
      const sliderValueDisplay = document.getElementById('slider-value-display');
      sliderInput.addEventListener('input', () => {
        sliderValueDisplay.textContent = sliderInput.value + unit;
      });
    } else if (type === 'ordering') {
      grid.style.display = 'none';
      orderingContainer.style.display = 'block';
      orderingSubmit.style.display = 'block';
      orderingSubmit.disabled = false;
      renderOrderingItems(orderingItems);
    } else if (type === 'freetext') {
      grid.style.display = 'none';
      freetextInput.style.display = 'block';
      freetextSubmit.style.display = 'block';
      freetextInput.value = '';
      freetextInput.disabled = false;
      freetextSubmit.disabled = false;
    } else if (type === 'truefalse') {
      grid.style.display = 'grid';
      grid.className = 'answer-grid cols-1';
      grid.innerHTML = `
      <button class="answer-btn btn-green" data-index="0" aria-label="Repondre Vrai"><span class="shape">✅</span><span class="text">Vrai</span></button>
      <button class="answer-btn btn-red" data-index="1" aria-label="Repondre Faux"><span class="shape">❌</span><span class="text">Faux</span></button>`;
      attachAnswerListeners();
    } else if (type === 'multi') {
      grid.style.display = 'grid';
      grid.className = 'answer-grid';
      multiHint.style.display = 'block';
      multiSubmit.style.display = 'block';
      multiSubmit.disabled = false;
      grid.innerHTML = choices
        .map(
          (c, i) =>
            `<button class="answer-btn ${barColors[i] || 'btn-red'}" data-index="${i}" aria-label="Réponse ${i + 1}: ${decodeHTML(c)}" aria-pressed="false">
        <span class="shape">${shapeIcons[i] || ''}</span><span class="text">${c}</span>
      </button>`,
        )
        .join('');
      attachMultiListeners();
    } else {
      grid.style.display = 'grid';
      grid.className = 'answer-grid';
      grid.innerHTML = choices
        .map(
          (c, i) =>
            `<button class="answer-btn ${barColors[i] || 'btn-red'}" data-index="${i}" aria-label="Réponse ${i + 1}: ${decodeHTML(c)}">
        <span class="shape">${shapeIcons[i] || ''}</span><span class="text">${c}</span>
      </button>`,
        )
        .join('');
      attachAnswerListeners();
    }

    // Spectators see the question but can't interact
    if (isSpectator) {
      document.querySelectorAll('#answer-grid .answer-btn').forEach((b) => {
        b.disabled = true;
        b.style.opacity = '0.7';
      });
      freetextInput.disabled = true;
      freetextSubmit.disabled = true;
      if (document.getElementById('multi-submit'))
        document.getElementById('multi-submit').disabled = true;
      if (document.getElementById('ordering-submit'))
        document.getElementById('ordering-submit').disabled = true;
      if (document.getElementById('slider-submit'))
        document.getElementById('slider-submit').disabled = true;
      const pSlider = document.getElementById('player-slider');
      if (pSlider) pSlider.disabled = true;
      document.querySelectorAll('.ordering-drag-item').forEach((el) => {
        el.draggable = false;
      });
    }

    showScreen('question');
    AudioSystem.startTensionMusic(timeLimit);
  },
);

function attachAnswerListeners() {
  document.querySelectorAll('#answer-grid .answer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const idx = parseInt(btn.dataset.index);
      AudioSystem.play('click');
      vibrate(VIBRATION.ANSWER_TAP);

      document.querySelectorAll('#answer-grid .answer-btn').forEach((b) => {
        if (b === btn) b.classList.add('selected');
        else b.classList.add('dimmed');
        b.disabled = true;
      });

      socket.emit('player:answer', {
        pin: currentPin,
        questionIndex: currentQuestionIndex,
        answerIndex: idx,
      });
      setTimeout(() => showScreen('waiting'), TIMING.ANSWER_TRANSITION_MS);
    });
  });
}

function attachMultiListeners() {
  document.querySelectorAll('#answer-grid .answer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (answered) return;
      const idx = parseInt(btn.dataset.index);
      AudioSystem.play('click');

      if (selectedMulti.includes(idx)) {
        selectedMulti = selectedMulti.filter((i) => i !== idx);
        btn.classList.remove('selected');
        btn.setAttribute('aria-pressed', 'false');
      } else {
        selectedMulti.push(idx);
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  });
}

// Multi submit
document.getElementById('multi-submit').addEventListener('click', () => {
  if (answered || selectedMulti.length === 0) return;
  answered = true;
  document.getElementById('multi-submit').disabled = true;
  document.querySelectorAll('#answer-grid .answer-btn').forEach((b) => (b.disabled = true));
  socket.emit('player:answer', {
    pin: currentPin,
    questionIndex: currentQuestionIndex,
    answerIndex: selectedMulti,
  });
  setTimeout(() => showScreen('waiting'), TIMING.ANSWER_TRANSITION_MS);
});

// Freetext submit
document.getElementById('freetext-submit').addEventListener('click', submitFreetext);
document.getElementById('freetext-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitFreetext();
});

function submitFreetext() {
  if (answered) return;
  const val = document.getElementById('freetext-input').value.trim();
  if (!val) return;
  answered = true;
  document.getElementById('freetext-input').disabled = true;
  document.getElementById('freetext-submit').disabled = true;
  socket.emit('player:answer', {
    pin: currentPin,
    questionIndex: currentQuestionIndex,
    answerIndex: val,
  });
  setTimeout(() => showScreen('waiting'), TIMING.ANSWER_TRANSITION_MS);
}

// ========== ORDERING (drag & drop) ==========

function renderOrderingItems(items) {
  const container = document.getElementById('ordering-container');
  container.innerHTML = items
    .map(
      (item, i) => `
    <div class="ordering-drag-item" draggable="true" data-index="${i}">
      <span class="drag-handle">☰</span>
      <span class="drag-text">${item}</span>
    </div>
  `,
    )
    .join('');

  let draggedEl = null;

  // --- Desktop drag & drop ---
  container.querySelectorAll('.ordering-drag-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      draggedEl = el;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggedEl = null;
      container
        .querySelectorAll('.ordering-drag-item')
        .forEach((item) => item.classList.remove('drag-over'));
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedEl && el !== draggedEl) {
        el.classList.add('drag-over');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (draggedEl && el !== draggedEl) {
        const allItems = [...container.querySelectorAll('.ordering-drag-item')];
        const fromIdx = allItems.indexOf(draggedEl);
        const toIdx = allItems.indexOf(el);
        if (fromIdx < toIdx) {
          el.after(draggedEl);
        } else {
          el.before(draggedEl);
        }
        AudioSystem.play('click');
      }
    });
  });

  // --- Mobile touch drag & drop ---
  let touchClone = null;
  let touchOffsetY = 0;
  let touchOffsetX = 0;
  let placeholder = null;
  let autoScrollRAF = null;
  let lastDropTarget = null;
  const LONG_PRESS_MS = 150;
  const AUTO_SCROLL_ZONE = 60;
  const AUTO_SCROLL_SPEED = 6;

  function getOrderingItems() {
    return [...container.querySelectorAll('.ordering-drag-item:not(.ordering-placeholder)')];
  }

  function createPlaceholder() {
    placeholder = document.createElement('div');
    placeholder.className = 'ordering-placeholder';
    placeholder.style.height = draggedEl.offsetHeight + 'px';
  }

  function removePlaceholder() {
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
    placeholder = null;
  }

  function createTouchClone(el, touch) {
    const rect = el.getBoundingClientRect();
    touchOffsetX = touch.clientX - rect.left;
    touchOffsetY = touch.clientY - rect.top;

    touchClone = el.cloneNode(true);
    touchClone.className = 'ordering-drag-item ordering-touch-clone';
    touchClone.style.width = rect.width + 'px';
    touchClone.style.left = (touch.clientX - touchOffsetX) + 'px';
    touchClone.style.top = (touch.clientY - touchOffsetY) + 'px';
    document.body.appendChild(touchClone);
  }

  function moveTouchClone(touch) {
    if (!touchClone) return;
    touchClone.style.left = (touch.clientX - touchOffsetX) + 'px';
    touchClone.style.top = (touch.clientY - touchOffsetY) + 'px';
  }

  function removeTouchClone() {
    if (touchClone && touchClone.parentNode) {
      touchClone.parentNode.removeChild(touchClone);
    }
    touchClone = null;
  }

  function autoScroll(touchY) {
    cancelAnimationFrame(autoScrollRAF);
    const scrollParent = container.closest('.screen') || document.documentElement;
    const vpTop = 0;
    const vpBottom = window.innerHeight;

    function step() {
      if (!draggedEl) return;
      if (touchY < vpTop + AUTO_SCROLL_ZONE) {
        scrollParent.scrollTop -= AUTO_SCROLL_SPEED;
        autoScrollRAF = requestAnimationFrame(step);
      } else if (touchY > vpBottom - AUTO_SCROLL_ZONE) {
        scrollParent.scrollTop += AUTO_SCROLL_SPEED;
        autoScrollRAF = requestAnimationFrame(step);
      }
    }
    step();
  }

  function findDropTarget(touchX, touchY) {
    // Temporarily hide the clone so elementFromPoint finds the real items
    if (touchClone) touchClone.style.display = 'none';
    const el = document.elementFromPoint(touchX, touchY);
    if (touchClone) touchClone.style.display = '';
    if (!el) return null;
    const item = el.closest('.ordering-drag-item');
    if (item && item !== draggedEl && item !== touchClone && !item.classList.contains('ordering-placeholder')) {
      return item;
    }
    return null;
  }

  function updatePlaceholderPosition(dropTarget, touchY) {
    if (!dropTarget || !placeholder) return;
    const rect = dropTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (touchY < midY) {
      dropTarget.before(placeholder);
    } else {
      dropTarget.after(placeholder);
    }
  }

  container.querySelectorAll('.ordering-drag-item').forEach((el) => {
    let longPressTimer = null;
    let isDragging = false;

    el.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      // Start a long-press timer for drag activation
      longPressTimer = setTimeout(() => {
        isDragging = true;
        draggedEl = el;
        el.classList.add('dragging');

        createPlaceholder();
        el.before(placeholder);
        createTouchClone(el, touch);

        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(20);
      }, LONG_PRESS_MS);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!isDragging) {
        // If finger moves before long press, cancel drag initiation
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        return;
      }
      e.preventDefault();

      const touch = e.touches[0];
      moveTouchClone(touch);
      autoScroll(touch.clientY);

      const dropTarget = findDropTarget(touch.clientX, touch.clientY);
      if (dropTarget !== lastDropTarget) {
        // Clear previous highlight
        container.querySelectorAll('.ordering-drag-item').forEach((item) => item.classList.remove('drag-over'));
        if (dropTarget) {
          dropTarget.classList.add('drag-over');
          updatePlaceholderPosition(dropTarget, touch.clientY);
        }
        lastDropTarget = dropTarget;
      } else if (dropTarget) {
        // Update placeholder even if same target (finger might cross midpoint)
        updatePlaceholderPosition(dropTarget, touch.clientY);
      }
    }, { passive: false });

    el.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      cancelAnimationFrame(autoScrollRAF);

      if (!isDragging) return;

      // Insert the dragged element at the placeholder position
      if (placeholder && placeholder.parentNode) {
        placeholder.before(draggedEl);
        AudioSystem.play('click');
        if (navigator.vibrate) navigator.vibrate(10);
      }

      el.classList.remove('dragging');
      container.querySelectorAll('.ordering-drag-item').forEach((item) => item.classList.remove('drag-over'));
      removePlaceholder();
      removeTouchClone();
      draggedEl = null;
      lastDropTarget = null;
      isDragging = false;
    });

    el.addEventListener('touchcancel', () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      cancelAnimationFrame(autoScrollRAF);

      if (isDragging) {
        el.classList.remove('dragging');
        container.querySelectorAll('.ordering-drag-item').forEach((item) => item.classList.remove('drag-over'));
        removePlaceholder();
        removeTouchClone();
        draggedEl = null;
        lastDropTarget = null;
        isDragging = false;
      }
    });
  });
}

document.getElementById('ordering-submit').addEventListener('click', () => {
  if (answered) return;
  answered = true;
  document.getElementById('ordering-submit').disabled = true;
  const container = document.getElementById('ordering-container');
  const items = container.querySelectorAll('.ordering-drag-item');
  // Build the answer: map display positions back to original indices
  const displayOrder = Array.from(items).map((el) => parseInt(el.dataset.index));
  // Convert display indices to original indices using orderingMap
  const answerOrder = displayOrder.map((displayIdx) => currentOrderingMap[displayIdx]);
  socket.emit('player:answer', {
    pin: currentPin,
    questionIndex: currentQuestionIndex,
    answerIndex: answerOrder,
  });
  items.forEach((el) => {
    el.draggable = false;
    el.style.opacity = '0.7';
  });
  setTimeout(() => showScreen('waiting'), TIMING.ANSWER_TRANSITION_MS);
});

// Slider submit
document.getElementById('slider-submit').addEventListener('click', () => {
  if (answered) return;
  answered = true;
  document.getElementById('slider-submit').disabled = true;
  const sliderInput = document.getElementById('player-slider');
  const val = parseFloat(sliderInput.value);
  sliderInput.disabled = true;
  AudioSystem.play('click');
  vibrate(VIBRATION.ANSWER_TAP);
  socket.emit('player:answer', {
    pin: currentPin,
    questionIndex: currentQuestionIndex,
    answerIndex: val,
  });
  setTimeout(() => showScreen('waiting'), TIMING.ANSWER_TRANSITION_MS);
});

// ========== TIMER ==========

socket.on('game:timer-tick', ({ remaining }) => {
  document.getElementById('timer-display').textContent = remaining;
  // Announce key milestones to screen readers (avoid spamming every second)
  if (remaining === 30 || remaining === 10 || remaining === 5) {
    const srEl = document.getElementById('timer-sr-announce');
    if (srEl) srEl.textContent = `${remaining} secondes restantes`;
  }
});

// ========== ANSWER COUNTER (real-time) ==========

socket.on('game:answer-count', ({ answered: count, total }) => {
  const el = document.getElementById('player-answer-count');
  if (el) {
    el.textContent = `${count}/${total} joueurs ont répondu`;
    el.style.display = 'block';
  }
});

socket.on('game:time-up', ({ explanation, explanationImage }) => {
  AudioSystem.stopTensionMusic();
  if (!answered || isSpectator) {
    document.querySelectorAll('#answer-grid .answer-btn').forEach((b) => {
      b.disabled = true;
    });
    document.getElementById('freetext-input').disabled = true;
    document.getElementById('freetext-submit').disabled = true;
    document.getElementById('multi-submit').disabled = true;
    document.getElementById('ordering-submit').disabled = true;
    document.getElementById('slider-submit').disabled = true;
    const playerSlider = document.getElementById('player-slider');
    if (playerSlider) playerSlider.disabled = true;
    document.querySelectorAll('.ordering-drag-item').forEach((el) => {
      el.draggable = false;
    });
    showScreen('waiting');
  }
  // Store explanation for display on result screen
  window._currentExplanation = explanation || null;
  window._currentExplanationImage = explanationImage || null;
});

// ========== RESULT ==========

function revealCorrectAnswers(result) {
  const {
    correctIndex,
    correctIndices,
    correctOrder,
    acceptedAnswers,
    correctValue,
    tolerance,
    unit,
  } = result;

  if (currentQuestionType === 'slider' && correctValue != null) {
    const container = document.getElementById('slider-container');
    const tolStr = tolerance > 0 ? ` ± ${tolerance}` : '';
    const unitStr = unit || '';
    const revealEl = document.createElement('div');
    revealEl.className = 'slider-correct-reveal';
    revealEl.innerHTML = `<strong>Bonne réponse :</strong> ${correctValue}${tolStr} ${unitStr}`;
    container.appendChild(revealEl);
    const sliderInput = document.getElementById('player-slider');
    if (sliderInput) sliderInput.disabled = true;
  } else if (currentQuestionType === 'mcq' || currentQuestionType === 'truefalse') {
    document.querySelectorAll('#answer-grid .answer-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (i === correctIndex) {
        btn.classList.add('correct-reveal');
        btn.classList.remove('dimmed');
      } else {
        btn.classList.add('wrong-reveal');
        btn.classList.remove('selected');
      }
    });
  } else if (currentQuestionType === 'multi' && correctIndices) {
    document.querySelectorAll('#answer-grid .answer-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (correctIndices.includes(i)) {
        btn.classList.add('correct-reveal');
        btn.classList.remove('dimmed');
      } else {
        btn.classList.add('wrong-reveal');
        btn.classList.remove('selected');
      }
    });
  } else if (currentQuestionType === 'freetext' && acceptedAnswers) {
    const correctText = document.createElement('div');
    correctText.className = 'freetext-correct-reveal';
    correctText.innerHTML = '<strong>Réponses acceptées :</strong> ' + acceptedAnswers.join(', ');
    const freetextInput = document.getElementById('freetext-input');
    freetextInput.parentNode.insertBefore(correctText, freetextInput.nextSibling);
  } else if (currentQuestionType === 'ordering' && correctOrder) {
    const items = document.querySelectorAll('#ordering-container .ordering-drag-item');
    items.forEach((el) => {
      el.style.opacity = '0.5';
    });
    const correctLabel = document.createElement('div');
    correctLabel.className = 'ordering-correct-reveal';
    correctLabel.textContent = result.correct ? 'Bon ordre !' : "Ce n'etait pas le bon ordre";
    document.getElementById('ordering-container').appendChild(correctLabel);
  }
}

socket.on(
  'game:answer-result',
  ({
    correct,
    points,
    rank,
    totalPlayers,
    totalScore,
    correctIndex,
    correctIndices,
    correctOrder,
    acceptedAnswers,
  }) => {
    AudioSystem.stopTensionMusic();
    // First, reveal correct answers on the question screen
    revealCorrectAnswers({ correct, correctIndex, correctIndices, correctOrder, acceptedAnswers });

    // Show question screen with revealed answers for a moment, then show result
    showScreen('question');

    setTimeout(() => {
      const icon = document.getElementById('result-icon');
      const text = document.getElementById('result-text');
      const pts = document.getElementById('result-points');

      if (correct) {
        icon.textContent = '✓';
        icon.className = 'success-icon result-correct';
        text.textContent = 'Bonne réponse !';
        text.className = 'result-text result-correct';
        pts.textContent = `+${points} points`;
        vibrate(VIBRATION.CORRECT);
      } else {
        icon.textContent = '✗';
        icon.className = 'success-icon result-wrong';
        text.textContent = 'Mauvaise réponse';
        text.className = 'result-text result-wrong';
        pts.textContent = '0 points';
        vibrate(VIBRATION.WRONG);
      }

      // Show real-time rank
      const rankEl = document.getElementById('result-rank');
      if (rank && totalPlayers) {
        const suffix = rank === 1 ? 'er' : 'e';
        rankEl.innerHTML = `${rank}${suffix} / ${totalPlayers} &middot; ${totalScore} pts au total`;
        rankEl.style.display = 'inline-block';
      } else {
        rankEl.style.display = 'none';
      }

      const explanationEl = document.getElementById('result-explanation');
      if (window._currentExplanation) {
        explanationEl.innerHTML = '💡 ' + window._currentExplanation +
          (window._currentExplanationImage ? `<img class="explanation-image" src="${window._currentExplanationImage}" alt="">` : '');
        explanationEl.style.display = 'block';
      } else {
        explanationEl.style.display = 'none';
      }

      showScreen('result');
    }, TIMING.RESULT_REVEAL_MS);
  },
);

// ========== LEADERBOARD ==========

socket.on('game:leaderboard', ({ rankings }) => {
  renderPlayerLeaderboard(rankings);
  showScreen('leaderboard');
  // Reset reaction buttons
  document.querySelectorAll('.reaction-btn').forEach((b) => b.classList.remove('reacted'));
});

function renderPlayerLeaderboard(rankings) {
  document.getElementById('player-leaderboard').innerHTML = rankings
    .map((r, i) => {
      const isMe = r.nickname === currentNickname;
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      return `<div class="leaderboard-row${isMe ? ' highlight' : ''}" style="animation-delay: ${i * ANIMATION.LEADERBOARD_ROW_DELAY_S}s">
      <div class="avatar" style="background:${r.avatar?.color || '#666'}">${r.avatar?.icon || '👤'}</div>
      <div class="rank ${rankClass}">${r.rank}</div>
      <div class="name">${r.nickname}${isMe ? ' (toi)' : ''}${r.streak > 1 ? `<span class="streak-badge">🔥${r.streak}</span>` : ''}</div>
      <div class="score">${r.score}</div>
    </div>`;
    })
    .join('');
}

// ========== REACTIONS ==========

document.querySelectorAll('.reaction-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('reacted')) return;
    btn.classList.add('reacted');
    socket.emit('player:react', { pin: currentPin, emoji: btn.dataset.emoji });
    AudioSystem.play('click');
  });
});

socket.on('game:reaction', ({ nickname, emoji }) => {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;
  el.style.left = Math.random() * 80 + 10 + '%';
  el.style.bottom = '20%';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), TIMING.REACTION_LIFETIME_MS);
});

// ========== PODIUM / FINAL ==========

socket.on('game:finished', ({ podium, rankings }) => {
  sessionStorage.removeItem('alihoot-session');
  renderPodiumWithSuspense(podium);
  renderFinalLeaderboard(rankings);
  showScreen('podium');
});

function renderPodiumWithSuspense(podium) {
  const el = document.getElementById('podium');
  // Display order: 3rd, 2nd, 1st (suspense reveal)
  const revealOrder = [2, 1, 0]; // indices into podium array
  const classes = ['third', 'second', 'first'];
  const medals = ['🥉', '🥈', '🥇'];
  const delays = PODIUM.DELAYS_MS;

  el.innerHTML = '';

  revealOrder.forEach((podiumIdx, step) => {
    const p = podium[podiumIdx];
    if (!p) return;

    setTimeout(() => {
      const place = document.createElement('div');
      place.className = 'podium-place podium-reveal';
      place.innerHTML = `
        <div class="podium-avatar">${p.avatar?.icon || '👤'}</div>
        <div class="podium-name">${p.nickname}</div>
        <div class="podium-score">${p.score} pts</div>
        <div class="podium-block ${classes[step]}">${medals[step]}</div>
      `;

      // Insert in visual order: third on right, second on left, first in center
      if (step === 0) el.appendChild(place); // 3rd
      else if (step === 1) el.insertBefore(place, el.firstChild); // 2nd goes before 3rd
      else el.insertBefore(place, el.children[1] || null); // 1st goes between

      AudioSystem.play(step === 2 ? 'victory' : 'leaderboard');

      // Start confetti when 1st place is revealed
      if (step === 2) startConfetti();
    }, delays[step]);
  });
}

function renderFinalLeaderboard(rankings) {
  const el = document.getElementById('final-leaderboard');
  el.innerHTML = rankings
    .slice(0, ANIMATION.FINAL_MAX_ROWS)
    .map((r, i) => {
      const isMe = r.nickname === currentNickname;
      return `<div class="leaderboard-row${isMe ? ' highlight' : ''}" style="animation-delay: ${i * ANIMATION.FINAL_ROW_DELAY_S}s">
      <div class="avatar" style="background:${r.avatar?.color || '#666'}">${r.avatar?.icon || '👤'}</div>
      <div class="rank">${r.rank}</div>
      <div class="name">${r.nickname}</div>
      <div class="score">${r.score}</div>
    </div>`;
    })
    .join('');

  const me = rankings.find((r) => r.nickname === currentNickname);
  if (me) {
    if (isTraining) {
      document.getElementById('your-position').textContent =
        `Entraînement terminé ! Score : ${me.score} pts`;
    } else {
      document.getElementById('your-position').textContent =
        `Tu es ${me.rank}${me.rank === 1 ? 'er' : 'e'} sur ${rankings.length} joueurs !`;
    }
  }
}

// ========== ACHIEVEMENTS ==========

const ACHIEVEMENT_META = {
  first_game: { icon: '🎮', label: 'Première partie' },
  games_5: { icon: '🎯', label: 'Habitué' },
  games_10: { icon: '🏅', label: 'Vétéran' },
  games_25: { icon: '🔥', label: 'Accro' },
  streak_3: { icon: '⚡', label: 'En série' },
  streak_5: { icon: '💥', label: 'Inarrêtable' },
  streak_10: { icon: '🌟', label: 'Parfait' },
  score_5000: { icon: '📈', label: 'Bon score' },
  score_10000: { icon: '💎', label: 'Expert' },
  podium_1: { icon: '🏆', label: 'Premier podium' },
  podium_3: { icon: '👑', label: 'Habitué du podium' },
  winner_1: { icon: '🥇', label: 'Première victoire' },
  winner_5: { icon: '🏆', label: 'Champion' },
};

socket.on('achievement:unlocked', ({ achievements }) => {
  const container = document.getElementById('achievement-toasts');
  if (!container) return;

  achievements.forEach((id, i) => {
    const meta = ACHIEVEMENT_META[id] || { icon: '🏅', label: id };
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.style.animationDelay = `${i * TIMING.ACHIEVEMENT_STAGGER_MS / 1000}s, ${(TIMING.ACHIEVEMENT_BASE_DURATION_MS - TIMING.ACHIEVEMENT_STAGGER_MS * 1.5) / 1000 + i * TIMING.ACHIEVEMENT_STAGGER_MS / 1000}s`;
    toast.innerHTML = `
      <div class="achievement-toast-icon">${meta.icon}</div>
      <div class="achievement-toast-text">
        <div class="achievement-toast-title">Succès débloqué !</div>
        <div>${meta.label}</div>
      </div>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), TIMING.ACHIEVEMENT_BASE_DURATION_MS + i * TIMING.ACHIEVEMENT_STAGGER_MS);
  });

  AudioSystem.play('correct');
});

// ========== PAUSE ==========

socket.on('game:paused', () => {
  document.getElementById('player-pause-overlay').style.display = 'flex';
});

socket.on('game:resumed', () => {
  document.getElementById('player-pause-overlay').style.display = 'none';
});

// ========== DISCONNECT ==========

socket.on('game:host-disconnected', () => {
  if (isTraining) return; // Training mode: we are the host
  document.getElementById('q-text') &&
    (document.getElementById('q-text').textContent = "L'hôte s'est déconnecté...");
});

// ========== TRAINING MODE ==========

document.getElementById('training-btn').addEventListener('click', async () => {
  showScreen('training');
  const list = document.getElementById('training-quiz-list');
  const error = document.getElementById('training-error');
  list.innerHTML = '<p style="text-align:center;">Chargement...</p>';
  error.textContent = '';

  try {
    const res = await fetch(BACKEND_URL + '/api/quizzes');
    const quizzes = await res.json();

    // Also include local quizzes
    let localQuizzes = [];
    try {
      localQuizzes = JSON.parse(localStorage.getItem('alihoot-saved-quizzes') || '[]');
    } catch {}

    if (quizzes.length === 0 && localQuizzes.length === 0) {
      list.innerHTML =
        '<p style="text-align:center; color:var(--card-label);">Aucun quiz disponible. Cree-en un depuis la page Admin !</p>';
      return;
    }

    let html = '';

    if (quizzes.length > 0) {
      html += quizzes
        .map(
          (q) => `
        <button class="btn training-quiz-btn" data-quiz-id="${q.id}" style="width:100%; margin-bottom:8px; text-align:left; padding:12px;">
          <strong>${q.title}</strong>
          <small style="display:block; opacity:0.7;">${q.questions.length} questions</small>
        </button>
      `,
        )
        .join('');
    }

    if (localQuizzes.length > 0) {
      html +=
        '<p style="margin:10px 0 5px; color:var(--card-label); font-size:0.85rem;">Quiz locaux :</p>';
      html += localQuizzes
        .map(
          (q, i) => `
        <button class="btn training-quiz-btn training-local" data-local-index="${i}" style="width:100%; margin-bottom:8px; text-align:left; padding:12px;">
          <strong>${q.title}</strong>
          <small style="display:block; opacity:0.7;">${q.questions.length} questions</small>
        </button>
      `,
        )
        .join('');
    }

    list.innerHTML = html;

    // Cloud quiz click
    list.querySelectorAll('[data-quiz-id]').forEach((btn) => {
      btn.addEventListener('click', () => startTraining(btn.dataset.quizId));
    });

    // Local quiz click — need to create it on server first
    list.querySelectorAll('[data-local-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const quiz = localQuizzes[parseInt(btn.dataset.localIndex)];
        if (quiz) startTrainingLocal(quiz);
      });
    });
  } catch (e) {
    list.innerHTML = '';
    error.textContent = 'Erreur lors du chargement des quiz';
  }
});

document.getElementById('training-back').addEventListener('click', () => {
  showScreen('join');
});

function startTraining(quizId) {
  const nickname = document.getElementById('nickname-input').value.trim() || 'Joueur';
  isTraining = true;
  socket.emit('training:start', {
    quizId,
    nickname,
    avatar: { icon: chosenIcon, color: chosenColor },
  });
}

function startTrainingLocal(quiz) {
  const nickname = document.getElementById('nickname-input').value.trim() || 'Joueur';
  isTraining = true;

  // Create the quiz on the server first, then start training
  socket.emit('admin:create-quiz', {
    title: quiz.title,
    questions: quiz.questions,
    shuffleQuestions: quiz.shuffleQuestions || false,
    shuffleChoices: quiz.shuffleChoices || false,
  });

  socket.once('admin:quiz-created', ({ quizId }) => {
    socket.emit('training:start', {
      quizId,
      nickname,
      avatar: { icon: chosenIcon, color: chosenColor },
    });
  });
}

socket.on('training:ready', ({ pin, nickname, avatar, quiz }) => {
  currentPin = pin;
  currentNickname = nickname;
  currentAvatar = avatar;

  document.getElementById('lobby-avatar').textContent = avatar?.icon || '👤';
  document.getElementById('lobby-name').textContent = nickname;
  showScreen('lobby');
});
