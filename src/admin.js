import { io } from 'socket.io-client';
import { AudioSystem } from './audio.js';
import { startConfetti } from './confetti.js';
import { AdminAuth } from './auth.js';
import QRious from 'qrious';
import html2canvas from 'html2canvas';

const BACKEND_URL = import.meta.env.PROD ? 'https://alihoot.onrender.com' : '';
const socket = io(BACKEND_URL || undefined);
// Expose socket for auth module
window._socket = socket;

// ========== LOADING OVERLAY ==========
const _loadingOverlay = document.getElementById('loading-overlay');
const _loadingText = document.getElementById('loading-text');
let _loadingStart = Date.now();
let _loadingInterval = setInterval(() => {
  const elapsed = Math.floor((Date.now() - _loadingStart) / 1000);
  if (_loadingText && elapsed > 3) {
    _loadingText.textContent = `Connexion au serveur... (${elapsed}s)`;
  }
}, 1000);

socket.on('connect', () => {
  if (_loadingOverlay) _loadingOverlay.classList.add('hidden');
  clearInterval(_loadingInterval);
});

// State
let currentPin = null;
let adminToken = null;
let questionCount = 0;
let currentQuestionData = null;
let totalQuestions = 0;

// Screens
const screens = {
  create: document.getElementById('create-screen'),
  room: document.getElementById('room-screen'),
  questionDisplay: document.getElementById('question-display'),
  stats: document.getElementById('stats-screen'),
  leaderboard: document.getElementById('admin-leaderboard'),
  final: document.getElementById('final-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ========== SOUND & THEME TOGGLES ==========

let soundOn = true;
let musicOn = true;

document.getElementById('toggle-sound').addEventListener('click', () => {
  soundOn = !soundOn;
  AudioSystem.toggle(soundOn);
  const btn = document.getElementById('toggle-sound');
  btn.textContent = soundOn ? '🔊' : '🔇';
  btn.classList.toggle('off', !soundOn);
});

document.getElementById('toggle-music').addEventListener('click', () => {
  musicOn = !musicOn;
  AudioSystem.toggleMusic(musicOn);
  const btn = document.getElementById('toggle-music');
  btn.textContent = musicOn ? '🎵' : '🎵';
  btn.classList.toggle('off', !musicOn);
});

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

// Audio events from server
socket.on('audio:play', ({ sound }) => AudioSystem.play(sound));

// ========== SAVED QUIZZES (localStorage) ==========

function getSavedQuizzes() {
  try {
    return JSON.parse(localStorage.getItem('alihoot-saved-quizzes') || '[]');
  } catch {
    return [];
  }
}

function saveQuizToLocal(title, questions) {
  const saved = getSavedQuizzes();
  saved.unshift({ title, questions, savedAt: Date.now() });
  if (saved.length > 20) saved.length = 20;
  localStorage.setItem('alihoot-saved-quizzes', JSON.stringify(saved));
  renderSavedQuizzes();
}

function deleteSavedQuiz(index) {
  const saved = getSavedQuizzes();
  saved.splice(index, 1);
  localStorage.setItem('alihoot-saved-quizzes', JSON.stringify(saved));
  renderSavedQuizzes();
}

function loadSavedQuiz(index) {
  const saved = getSavedQuizzes();
  const quiz = saved[index];
  if (!quiz) return;

  document.getElementById('quiz-title').value = quiz.title;
  document.getElementById('questions-list').innerHTML = '';
  questionCount = 0;
  quiz.questions.forEach((q) => addQuestion(q));
}

function renderSavedQuizzes() {
  const saved = getSavedQuizzes();
  const section = document.getElementById('saved-quizzes-section');
  const list = document.getElementById('saved-quiz-list');

  if (saved.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  list.innerHTML = saved
    .map(
      (q, i) =>
        `<div class="saved-quiz-chip" onclick="loadSavedQuiz(${i})">
      📝 ${q.title} (${q.questions.length}q)
      <span class="delete-saved" onclick="event.stopPropagation(); deleteSavedQuiz(${i})">&times;</span>
    </div>`,
    )
    .join('');
}

window.loadSavedQuiz = loadSavedQuiz;
window.deleteSavedQuiz = deleteSavedQuiz;

renderSavedQuizzes();

// ========== CLOUD QUIZZES (Supabase) ==========

async function loadCloudQuizzes() {
  try {
    const res = await fetch(BACKEND_URL + '/api/quizzes');
    const quizzes = await res.json();
    const section = document.getElementById('cloud-quizzes-section');
    const list = document.getElementById('cloud-quiz-list');

    if (!quizzes.length) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';

    list.innerHTML = quizzes
      .map((q) => {
        const date = new Date(q.created_at).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'short',
        });
        const qCount = q.questions ? q.questions.length : 0;
        return `<div class="saved-quiz-chip" onclick="loadCloudQuiz('${q.id}')">
        ☁️ ${q.title} (${qCount}q - ${date})
        <span class="delete-saved" onclick="event.stopPropagation(); deleteCloudQuiz('${q.id}')">&times;</span>
      </div>`;
      })
      .join('');
  } catch (e) {
    console.log('Cloud quizzes unavailable:', e.message);
  }
}

window.loadCloudQuiz = async function (id) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/quizzes/${id}`);
    const quiz = await res.json();
    if (!quiz || !quiz.questions) return;

    document.getElementById('quiz-title').value = quiz.title;
    document.getElementById('questions-list').innerHTML = '';
    questionCount = 0;
    quiz.questions.forEach((q) => addQuestion(q));
    if (quiz.shuffle_questions) document.getElementById('shuffle-questions').checked = true;
    if (quiz.shuffle_choices) document.getElementById('shuffle-choices').checked = true;
  } catch (e) {
    console.error('Failed to load cloud quiz:', e);
  }
};

window.deleteCloudQuiz = async function (id) {
  try {
    await AdminAuth.authFetch(`/api/quizzes/${id}`, { method: 'DELETE' });
    loadCloudQuizzes();
  } catch (e) {
    console.error('Failed to delete cloud quiz:', e);
  }
};

loadCloudQuizzes();

// ========== IMPORT / EXPORT ==========

document.getElementById('export-quiz-btn').addEventListener('click', () => {
  const title = document.getElementById('quiz-title').value.trim() || 'quiz';
  const blocks = document.querySelectorAll('.question-block');
  const questions = Array.from(blocks).map((block) => getQuestionDataFromBlock(block));

  const data = { title, questions };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alihoot-${title.replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import-quiz-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.title || !data.questions || !Array.isArray(data.questions)) {
        alert('Fichier JSON invalide : il faut un titre et des questions.');
        return;
      }

      document.getElementById('quiz-title').value = data.title;
      document.getElementById('questions-list').innerHTML = '';
      questionCount = 0;
      data.questions.forEach((q) => addQuestion(q));
    } catch (err) {
      alert('Erreur de lecture du fichier JSON : ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ========== QUIZ CREATOR ==========

const questionTypes = {
  mcq: { label: 'QCM', icon: '🔘' },
  truefalse: { label: 'Vrai/Faux', icon: '✅' },
  multi: { label: 'Multi-réponses', icon: '☑️' },
  freetext: { label: 'Réponse libre', icon: '✏️' },
  ordering: { label: 'Classement', icon: '📊' },
  slider: { label: 'Curseur', icon: '🎚️' },
};

const defaultTimeLimits = {
  mcq: 20,
  truefalse: 10,
  multi: 30,
  freetext: 30,
  ordering: 45,
  slider: 20,
};

function addQuestion(prefill = null) {
  questionCount++;
  const n = questionCount;
  const type = prefill?.type || 'mcq';
  const div = document.createElement('div');
  div.className = 'question-block';
  div.dataset.index = n;
  div.dataset.type = type;

  div.innerHTML = `
    <div class="q-header">
      <span class="q-number">Question ${n}</span>
      <div class="q-header-actions">
        <button class="q-action-btn" onclick="duplicateQuestion(this)" title="Dupliquer">📋</button>
        <button class="q-action-btn q-move-up" onclick="moveQuestion(this, -1)" title="Monter">▲</button>
        <button class="q-action-btn q-move-down" onclick="moveQuestion(this, 1)" title="Descendre">▼</button>
        <button class="q-remove" onclick="removeQuestion(this)" title="Supprimer">&times;</button>
      </div>
    </div>
    <div class="type-selector">
      ${Object.entries(questionTypes)
        .map(
          ([k, v]) =>
            `<button class="type-btn${k === type ? ' active' : ''}" data-type="${k}" onclick="changeQuestionType(this, '${k}')">${v.icon} ${v.label}</button>`,
        )
        .join('')}
    </div>
    <input type="text" class="q-text-input" placeholder="Intitulé de la question..." maxlength="200" value="${prefill?.text || ''}">
    <div class="media-inputs">
      <input type="text" class="image-input" placeholder="🖼️ URL de l'image (optionnel)" value="${prefill?.image || ''}">
      <input type="text" class="video-input" placeholder="🎬 URL de la video YouTube (optionnel)" value="${prefill?.video || ''}">
    </div>
    <div class="q-body"></div>
    <input type="text" class="explanation-input" placeholder="💡 Explication (optionnel, affichée après la réponse)" maxlength="300" value="${prefill?.explanation || ''}">
    <div class="q-options-row">
      <div class="time-select">
        <label>Temps :</label>
        <select class="time-select-input">
          ${[5, 10, 15, 20, 30, 45, 60, 90, 120]
            .map(
              (t) =>
                `<option value="${t}"${(prefill?.timeLimit || defaultTimeLimits[type] || 20) == t ? ' selected' : ''}>${t}s</option>`,
            )
            .join('\n          ')}
        </select>
      </div>
      <div class="points-select">
        <label>Points :</label>
        <select class="points-select-input">
          <option value="1"${(prefill?.pointsMultiplier || 1) == 1 ? ' selected' : ''}>x1</option>
          <option value="2"${(prefill?.pointsMultiplier || 1) == 2 ? ' selected' : ''}>x2 (bonus)</option>
          <option value="3"${(prefill?.pointsMultiplier || 1) == 3 ? ' selected' : ''}>x3 (super bonus)</option>
        </select>
      </div>
    </div>
  `;

  document.getElementById('questions-list').appendChild(div);
  renderQuestionBody(div, type, prefill);
}

function renderQuestionBody(block, type, prefill = null) {
  const body = block.querySelector('.q-body');
  block.dataset.type = type;

  if (type === 'slider') {
    const sMin = prefill?.sliderMin ?? 0;
    const sMax = prefill?.sliderMax ?? 100;
    const sStep = prefill?.sliderStep ?? 1;
    const correctVal = prefill?.correctValue ?? 50;
    const tol = prefill?.tolerance ?? 5;
    const unit = prefill?.unit ?? '';
    body.innerHTML = `
      <div class="slider-config">
        <div class="slider-config-row">
          <div class="slider-field">
            <label>Min</label>
            <input type="number" class="slider-min" value="${sMin}" step="any">
          </div>
          <div class="slider-field">
            <label>Max</label>
            <input type="number" class="slider-max" value="${sMax}" step="any">
          </div>
          <div class="slider-field">
            <label>Pas</label>
            <input type="number" class="slider-step" value="${sStep}" min="0.1" step="any">
          </div>
        </div>
        <div class="slider-config-row">
          <div class="slider-field">
            <label>Bonne réponse</label>
            <input type="number" class="slider-correct" value="${correctVal}" step="any">
          </div>
          <div class="slider-field">
            <label>Tolerance (±)</label>
            <input type="number" class="slider-tolerance" value="${tol}" min="0" step="any">
          </div>
          <div class="slider-field">
            <label>Unite</label>
            <input type="text" class="slider-unit" value="${unit}" maxlength="20" placeholder="kg, km, %...">
          </div>
        </div>
        <small style="color:var(--card-label);">Le joueur voit un curseur de <b>${sMin}</b> a <b>${sMax}</b>. Réponse acceptée : <b>${correctVal} ± ${tol}</b>${unit ? ' ' + unit : ''}</small>
      </div>`;
  } else if (type === 'ordering') {
    const items = prefill?.items || ['', '', '', ''];
    body.innerHTML = `
      <div class="ordering-list">
        <small style="color:var(--card-label);">Entre les elements dans le BON ordre (de haut en bas)</small>
        ${items
          .map(
            (item, i) => `
          <div class="ordering-item">
            <span class="ordering-num">${i + 1}.</span>
            <input type="text" placeholder="Element ${i + 1}" maxlength="100" value="${item}">
          </div>`,
          )
          .join('')}
      </div>
      <div class="choice-actions">
        <button class="choice-action-btn" onclick="addOrderingItem(this)">+ Element</button>
        <button class="choice-action-btn" onclick="removeOrderingItem(this)">- Element</button>
      </div>`;
  } else if (type === 'truefalse') {
    const correct = prefill?.correctIndex ?? 0;
    body.innerHTML = `
      <div class="choices-grid" style="grid-template-columns:1fr 1fr;">
        <div class="choice-item">
          <input type="radio" name="correct-${block.dataset.index}" value="0"${correct === 0 ? ' checked' : ''}>
          <span style="font-weight:700;color:var(--green);">✅ Vrai</span>
        </div>
        <div class="choice-item">
          <input type="radio" name="correct-${block.dataset.index}" value="1"${correct === 1 ? ' checked' : ''}>
          <span style="font-weight:700;color:var(--red);">❌ Faux</span>
        </div>
      </div>`;
  } else if (type === 'freetext') {
    const answers = prefill?.acceptedAnswers?.join(', ') || '';
    body.innerHTML = `
      <div class="freetext-answers">
        <input type="text" placeholder="Réponses acceptées (séparées par des virgules)" value="${answers}">
        <small>Ex: Paris, paris, PARIS</small>
      </div>`;
  } else if (type === 'multi') {
    const choices = prefill?.choices || ['', '', '', ''];
    const correctIndices = prefill?.correctIndices || [0];
    body.innerHTML = `
      <div class="choices-grid">
        ${choices
          .map(
            (c, i) => `
          <div class="choice-item">
            <input type="checkbox" name="correct-${block.dataset.index}" value="${i}"${correctIndices.includes(i) ? ' checked' : ''}>
            <input type="text" placeholder="Réponse ${i + 1}" maxlength="100" value="${c}">
          </div>`,
          )
          .join('')}
      </div>
      <div class="choice-actions">
        <button class="choice-action-btn" onclick="addChoice(this)">+ Choix</button>
        <button class="choice-action-btn" onclick="removeChoice(this)">- Choix</button>
      </div>`;
  } else {
    // mcq
    const choices = prefill?.choices || ['', '', '', ''];
    const correct = prefill?.correctIndex ?? 0;
    body.innerHTML = `
      <div class="choices-grid">
        ${choices
          .map(
            (c, i) => `
          <div class="choice-item">
            <input type="radio" name="correct-${block.dataset.index}" value="${i}"${i === correct ? ' checked' : ''}>
            <input type="text" placeholder="Réponse ${i + 1}" maxlength="100" value="${c}">
          </div>`,
          )
          .join('')}
      </div>
      <div class="choice-actions">
        <button class="choice-action-btn" onclick="addChoice(this)">+ Choix</button>
        <button class="choice-action-btn" onclick="removeChoice(this)">- Choix</button>
      </div>`;
  }
}

window.changeQuestionType = function (btn, type) {
  const block = btn.closest('.question-block');
  const prevType = block.dataset.type;
  const timeSelect = block.querySelector('.time-select-input');
  const currentTime = parseInt(timeSelect.value);

  block.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderQuestionBody(block, type);

  // Auto-adjust timer if it was still at the previous type's default
  if (currentTime === (defaultTimeLimits[prevType] || 20)) {
    timeSelect.value = defaultTimeLimits[type] || 20;
  }
};

window.addChoice = function (btn) {
  const block = btn.closest('.question-block');
  const grid = block.querySelector('.choices-grid');
  const items = grid.querySelectorAll('.choice-item');
  if (items.length >= 6) return;
  const type = block.dataset.type;
  const inputType = type === 'multi' ? 'checkbox' : 'radio';
  const idx = items.length;
  const colors = [
    'var(--red)',
    'var(--blue)',
    'var(--yellow)',
    'var(--green)',
    'var(--purple)',
    '#e67e22',
  ];
  const div = document.createElement('div');
  div.className = 'choice-item';
  div.innerHTML = `
    <input type="${inputType}" name="correct-${block.dataset.index}" value="${idx}">
    <input type="text" placeholder="Réponse ${idx + 1}" maxlength="100" style="border-left: 3px solid ${colors[idx] || '#999'};">
  `;
  grid.appendChild(div);
};

window.removeChoice = function (btn) {
  const block = btn.closest('.question-block');
  const grid = block.querySelector('.choices-grid');
  const items = grid.querySelectorAll('.choice-item');
  if (items.length <= 2) return;
  items[items.length - 1].remove();
};

window.addOrderingItem = function (btn) {
  const block = btn.closest('.question-block');
  const list = block.querySelector('.ordering-list');
  const items = list.querySelectorAll('.ordering-item');
  if (items.length >= 8) return;
  const idx = items.length;
  const div = document.createElement('div');
  div.className = 'ordering-item';
  div.innerHTML = `<span class="ordering-num">${idx + 1}.</span><input type="text" placeholder="Element ${idx + 1}" maxlength="100">`;
  list.appendChild(div);
};

window.removeOrderingItem = function (btn) {
  const block = btn.closest('.question-block');
  const list = block.querySelector('.ordering-list');
  const items = list.querySelectorAll('.ordering-item');
  if (items.length <= 2) return;
  items[items.length - 1].remove();
};

// Extract question data from a block element
function getQuestionDataFromBlock(block) {
  const text = block.querySelector('.q-text-input').value.trim();
  const type = block.dataset.type || 'mcq';
  const image = block.querySelector('.image-input')?.value.trim() || '';
  const timeLimit = parseInt(block.querySelector('.time-select-input').value);
  const pointsMultiplier = parseInt(block.querySelector('.points-select-input').value) || 1;
  const explanation = block.querySelector('.explanation-input')?.value.trim() || '';

  const video = block.querySelector('.video-input')?.value.trim() || '';
  const q = {
    text,
    type,
    image: image || null,
    video: video || null,
    timeLimit,
    pointsMultiplier,
    explanation: explanation || null,
  };

  if (type === 'slider') {
    q.sliderMin = parseFloat(block.querySelector('.slider-min')?.value) || 0;
    q.sliderMax = parseFloat(block.querySelector('.slider-max')?.value) || 100;
    q.sliderStep = parseFloat(block.querySelector('.slider-step')?.value) || 1;
    q.correctValue = parseFloat(block.querySelector('.slider-correct')?.value) || 0;
    q.tolerance = parseFloat(block.querySelector('.slider-tolerance')?.value) || 0;
    q.unit = block.querySelector('.slider-unit')?.value.trim() || '';
  } else if (type === 'ordering') {
    q.items = Array.from(block.querySelectorAll('.ordering-item input')).map((c) => c.value.trim());
  } else if (type === 'truefalse') {
    const radio = block.querySelector('input[type="radio"]:checked');
    q.correctIndex = radio ? parseInt(radio.value) : 0;
  } else if (type === 'freetext') {
    const input = block.querySelector('.freetext-answers input');
    q.acceptedAnswers = input
      ? input.value
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a)
      : [];
  } else if (type === 'multi') {
    q.choices = Array.from(block.querySelectorAll('.choice-item input[type="text"]')).map((c) =>
      c.value.trim(),
    );
    q.correctIndices = Array.from(
      block.querySelectorAll('.choice-item input[type="checkbox"]:checked'),
    ).map((c) => parseInt(c.value));
  } else {
    q.choices = Array.from(block.querySelectorAll('.choice-item input[type="text"]')).map((c) =>
      c.value.trim(),
    );
    const radio = block.querySelector('input[type="radio"]:checked');
    q.correctIndex = radio ? parseInt(radio.value) : 0;
  }

  return q;
}

window.duplicateQuestion = function (btn) {
  const block = btn.closest('.question-block');
  const data = getQuestionDataFromBlock(block);
  addQuestion(data);
};

window.moveQuestion = function (btn, direction) {
  const block = btn.closest('.question-block');
  const list = document.getElementById('questions-list');
  const blocks = [...list.querySelectorAll('.question-block')];
  const idx = blocks.indexOf(block);

  if (direction === -1 && idx > 0) {
    list.insertBefore(block, blocks[idx - 1]);
  } else if (direction === 1 && idx < blocks.length - 1) {
    list.insertBefore(blocks[idx + 1], block);
  }
  renumberQuestions();
};

window.removeQuestion = function (btn) {
  btn.closest('.question-block').remove();
  renumberQuestions();
};

function renumberQuestions() {
  const blocks = document.querySelectorAll('.question-block');
  blocks.forEach((block, i) => {
    block.querySelector('.q-number').textContent = `Question ${i + 1}`;
  });
  questionCount = blocks.length;
}

// ========== PREVIEW ==========

let previewIndex = 0;
let previewQuestions = [];

const previewBarColors = ['btn-red', 'btn-blue', 'btn-yellow', 'btn-green', 'btn-red', 'btn-blue'];
const previewShapes = ['&#9650;', '&#9670;', '&#9679;', '&#9724;', '&#9733;', '&#9829;'];

window.openPreview = function () {
  const blocks = document.querySelectorAll('.question-block');
  if (blocks.length === 0) return;

  previewQuestions = Array.from(blocks).map((block) => getQuestionDataFromBlock(block));
  previewIndex = 0;
  renderPreview();
  document.getElementById('preview-overlay').style.display = 'flex';
};

window.closePreview = function () {
  document.getElementById('preview-overlay').style.display = 'none';
};

window.previewPrev = function () {
  if (previewIndex > 0) {
    previewIndex--;
    renderPreview();
  }
};

window.previewNext = function () {
  if (previewIndex < previewQuestions.length - 1) {
    previewIndex++;
    renderPreview();
  }
};

function renderPreview() {
  const q = previewQuestions[previewIndex];
  const body = document.getElementById('preview-body');
  document.getElementById('preview-counter').textContent =
    `${previewIndex + 1}/${previewQuestions.length}`;

  const multiplierBadge =
    q.pointsMultiplier && q.pointsMultiplier > 1
      ? `<span class="multiplier-badge">x${q.pointsMultiplier}</span>`
      : '';

  let answersHtml = '';
  if (q.type === 'slider') {
    const unit = q.unit || '';
    const mid = ((q.sliderMin || 0) + (q.sliderMax || 100)) / 2;
    answersHtml = `<div class="slider-preview-container">
      <div class="slider-labels"><span>${q.sliderMin || 0}${unit}</span><span>${q.sliderMax || 100}${unit}</span></div>
      <input type="range" class="slider-input" min="${q.sliderMin || 0}" max="${q.sliderMax || 100}" step="${q.sliderStep || 1}" value="${mid}" disabled>
      <div class="slider-value">${mid}${unit}</div>
    </div>`;
  } else if (q.type === 'ordering') {
    const items = q.items || [];
    answersHtml = `<div class="preview-ordering">${items
      .map(
        (item) =>
          `<div class="ordering-drag-item" style="cursor:default;"><span class="drag-handle">☰</span><span class="drag-text">${item}</span></div>`,
      )
      .join('')}</div>`;
  } else if (q.type === 'truefalse') {
    answersHtml = `<div class="answer-grid cols-1" style="pointer-events:none;">
      <div class="answer-btn btn-green"><span class="shape">✅</span><span class="text">Vrai</span></div>
      <div class="answer-btn btn-red"><span class="shape">❌</span><span class="text">Faux</span></div>
    </div>`;
  } else if (q.type === 'freetext') {
    answersHtml = `<div style="text-align:center; opacity:0.7; font-weight:700; padding:20px;">✏️ Champ de réponse libre</div>`;
  } else {
    const choices = q.choices || [];
    answersHtml = `<div class="answer-grid" style="pointer-events:none;">
      ${choices
        .filter((c) => c)
        .map(
          (c, i) =>
            `<div class="answer-btn ${previewBarColors[i] || 'btn-red'}"><span class="shape">${previewShapes[i] || ''}</span><span class="text">${c}</span></div>`,
        )
        .join('')}
    </div>`;
  }

  body.innerHTML = `
    <div class="question-counter">Question ${previewIndex + 1} / ${previewQuestions.length} ${multiplierBadge}</div>
    <div class="timer-text" style="font-size:2rem;">${q.timeLimit}s</div>
    <div class="timer-bar-container"><div class="timer-bar" style="width:100%;"></div></div>
    ${q.image ? `<img class="question-image" src="${q.image}" style="display:block;" alt="">` : ''}
    ${
      q.video
        ? (() => {
            const ytId = extractYouTubeId(q.video);
            if (ytId)
              return `<div class="question-video" style="display:block;"><iframe src="https://www.youtube-nocookie.com/embed/${ytId}?rel=0" frameborder="0" allowfullscreen></iframe></div>`;
            return `<div class="question-video" style="display:block;"><video src="${q.video}" controls playsinline></video></div>`;
          })()
        : ''
    }
    <div class="question-text" style="font-size:1.2rem;">${q.text || '<em style="opacity:0.5;">Sans titre</em>'}</div>
    ${answersHtml}
    ${q.explanation ? `<div class="explanation-display">💡 ${q.explanation}</div>` : ''}
  `;
}

// Start with 1 question
addQuestion();

document.getElementById('add-question-btn').addEventListener('click', () => addQuestion());

// ========== CREATE QUIZ ==========

document.getElementById('create-quiz-btn').addEventListener('click', () => {
  const title = document.getElementById('quiz-title').value.trim();
  const errorEl = document.getElementById('create-error');

  if (!title) {
    errorEl.textContent = 'Donne un titre au quiz';
    return;
  }

  const blocks = document.querySelectorAll('.question-block');
  if (blocks.length === 0) {
    errorEl.textContent = 'Ajoute au moins une question';
    return;
  }

  const questions = [];
  let valid = true;

  blocks.forEach((block, i) => {
    if (!valid) return;
    const text = block.querySelector('.q-text-input').value.trim();
    const type = block.dataset.type || 'mcq';
    const image = block.querySelector('.image-input')?.value.trim() || '';
    const timeLimit = parseInt(block.querySelector('.time-select-input').value);
    const pointsMultiplier = parseInt(block.querySelector('.points-select-input').value) || 1;

    if (!text) {
      errorEl.textContent = `Question ${i + 1} : intitulé manquant`;
      valid = false;
      return;
    }

    const video = block.querySelector('.video-input')?.value.trim() || '';
    const explanation = block.querySelector('.explanation-input')?.value.trim() || '';
    const q = {
      text,
      type,
      image: image || null,
      video: video || null,
      timeLimit,
      pointsMultiplier,
      explanation: explanation || null,
    };

    if (type === 'slider') {
      q.sliderMin = parseFloat(block.querySelector('.slider-min')?.value) || 0;
      q.sliderMax = parseFloat(block.querySelector('.slider-max')?.value) || 100;
      q.sliderStep = parseFloat(block.querySelector('.slider-step')?.value) || 1;
      q.correctValue = parseFloat(block.querySelector('.slider-correct')?.value);
      q.tolerance = parseFloat(block.querySelector('.slider-tolerance')?.value) || 0;
      q.unit = block.querySelector('.slider-unit')?.value.trim() || '';
      if (isNaN(q.correctValue)) {
        errorEl.textContent = `Question ${i + 1} : valeur correcte manquante`;
        valid = false;
        return;
      }
    } else if (type === 'ordering') {
      const itemInputs = block.querySelectorAll('.ordering-item input');
      q.items = Array.from(itemInputs).map((c) => c.value.trim());
      if (q.items.filter((c) => c).length < 2) {
        errorEl.textContent = `Question ${i + 1} : min 2 elements`;
        valid = false;
        return;
      }
    } else if (type === 'truefalse') {
      const radio = block.querySelector('input[type="radio"]:checked');
      q.correctIndex = radio ? parseInt(radio.value) : 0;
    } else if (type === 'freetext') {
      const input = block.querySelector('.freetext-answers input');
      const answers = input.value
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a);
      if (answers.length === 0) {
        errorEl.textContent = `Question ${i + 1} : réponses acceptées manquantes`;
        valid = false;
        return;
      }
      q.acceptedAnswers = answers;
    } else if (type === 'multi') {
      const choiceInputs = block.querySelectorAll('.choice-item input[type="text"]');
      const checkboxes = block.querySelectorAll('.choice-item input[type="checkbox"]:checked');
      q.choices = Array.from(choiceInputs).map((c) => c.value.trim());
      q.correctIndices = Array.from(checkboxes).map((c) => parseInt(c.value));
      if (q.choices.filter((c) => c).length < 2) {
        errorEl.textContent = `Question ${i + 1} : min 2 réponses`;
        valid = false;
        return;
      }
      if (q.correctIndices.length === 0) {
        errorEl.textContent = `Question ${i + 1} : coche au moins une bonne réponse`;
        valid = false;
        return;
      }
    } else {
      const choiceInputs = block.querySelectorAll('.choice-item input[type="text"]');
      const radio = block.querySelector('input[type="radio"]:checked');
      q.choices = Array.from(choiceInputs).map((c) => c.value.trim());
      q.correctIndex = radio ? parseInt(radio.value) : 0;
      if (q.choices.filter((c) => c).length < 2) {
        errorEl.textContent = `Question ${i + 1} : min 2 réponses`;
        valid = false;
        return;
      }
    }

    questions.push(q);
  });

  if (!valid) return;
  errorEl.textContent = '';

  // Save to localStorage
  saveQuizToLocal(title, questions);

  const shuffleQuestions = document.getElementById('shuffle-questions').checked;
  const shuffleChoices = document.getElementById('shuffle-choices').checked;
  socket.emit('admin:create-quiz', { title, questions, shuffleQuestions, shuffleChoices });
});

socket.on('admin:quiz-created', ({ quizId }) => {
  socket.emit('admin:create-room', { quizId });
});

socket.on('admin:room-created', ({ pin, adminToken: token }) => {
  currentPin = pin;
  adminToken = token;
  sessionStorage.setItem('alihoot-admin', JSON.stringify({ pin, adminToken: token }));

  document.getElementById('room-pin').textContent = pin;
  const url = window.location.origin;
  document.getElementById('join-url').textContent = url;

  // Generate QR code
  const qrEl = document.getElementById('qr-code');
  qrEl.innerHTML = '';
  if (typeof QRious !== 'undefined') {
    const canvas = document.createElement('canvas');
    qrEl.appendChild(canvas);
    new QRious({
      element: canvas,
      value: url + '?pin=' + pin,
      size: 200,
      foreground: '#46178f',
      background: '#ffffff',
      level: 'M',
    });
  }

  showScreen('room');
  AudioSystem.startLobbyMusic();
});

socket.on('admin:error', ({ message }) => {
  document.getElementById('create-error').textContent = message;
});

// ========== ADMIN RECONNECTION ==========

(function tryReconnect() {
  try {
    const data = JSON.parse(sessionStorage.getItem('alihoot-admin') || 'null');
    if (data && data.pin && data.adminToken) {
      socket.emit('admin:reconnect', { pin: data.pin, adminToken: data.adminToken });
    }
  } catch {}
})();

socket.on('admin:reconnected', ({ pin, state, players, currentQuestionIndex, quiz }) => {
  currentPin = pin;
  totalQuestions = quiz.questions.length;
  document.getElementById('room-pin').textContent = pin;

  if (state === 'lobby') {
    showScreen('room');
    updatePlayerList(players);
  } else {
    // Resume to leaderboard view
    showScreen('leaderboard');
  }
});

// ========== ROOM / LOBBY ==========

function updatePlayerList(players) {
  const count = players.length;
  document.getElementById('player-count').textContent = `${count} joueur${count > 1 ? 's' : ''}`;
  document.getElementById('room-players').innerHTML = players
    .map(
      (p) =>
        `<div class="player-chip">
      <span class="chip-avatar">${p.avatar?.icon || '👤'}</span>
      ${p.nickname}
      <button class="kick-btn" onclick="kickPlayer('${p.nickname}')" title="Expulser">&times;</button>
    </div>`,
    )
    .join('');
  document.getElementById('start-game-btn').disabled = count === 0;
}

socket.on('room:player-joined', ({ players }) => {
  updatePlayerList(players);
  AudioSystem.play('join');
});

window.kickPlayer = function (nickname) {
  socket.emit('admin:kick', { pin: currentPin, nickname });
};

document.getElementById('start-game-btn').addEventListener('click', () => {
  socket.emit('admin:start-game', { pin: currentPin });
  document.getElementById('start-game-btn').disabled = true;
  AudioSystem.stopLobbyMusic();
});

// ========== GAME STARTING COUNTDOWN ==========

socket.on('game:starting', ({ countdown }) => {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');
  overlay.style.display = 'flex';
  let count = countdown;
  numEl.textContent = count;

  const interval = setInterval(() => {
    count--;
    AudioSystem.play('countdown');
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

// ========== GAME FLOW ==========

const barColors = ['btn-red', 'btn-blue', 'btn-yellow', 'btn-green', 'btn-red', 'btn-blue'];
const shapes = ['&#9650;', '&#9670;', '&#9679;', '&#9724;', '&#9733;', '&#9829;'];
const statBarColors = ['bar-red', 'bar-blue', 'bar-yellow', 'bar-green', 'bar-red', 'bar-blue'];

// YouTube URL parser
function extractYouTubeId(url) {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([a-zA-Z0-9_-]{11})/,
  );
  return match ? match[1] : null;
}

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
  }) => {
    currentQuestionData = {
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
    };
    totalQuestions = total;

    const multiplierBadge =
      pointsMultiplier && pointsMultiplier > 1
        ? ` <span class="multiplier-badge">x${pointsMultiplier}</span>`
        : '';
    document.getElementById('admin-q-counter').innerHTML =
      `Question ${questionIndex + 1} / ${total}${multiplierBadge}`;
    document.getElementById('admin-q-text').textContent = text;
    document.getElementById('admin-timer').textContent = timeLimit;
    document.getElementById('admin-answer-count').textContent = '0 réponses';

    // Progress bar
    const progressBar = document.getElementById('admin-progress-bar');
    progressBar.innerHTML = Array.from({ length: total }, (_, i) => {
      const cls = i < questionIndex ? 'done' : i === questionIndex ? 'current' : '';
      return `<div class="progress-dot ${cls}"></div>`;
    }).join('');

    // Image
    const imgEl = document.getElementById('admin-q-image');
    if (image) {
      imgEl.src = image;
      imgEl.style.display = 'block';
    } else {
      imgEl.style.display = 'none';
    }

    // Video
    const videoContainer = document.getElementById('admin-q-video');
    if (video) {
      const ytId = extractYouTubeId(video);
      if (ytId) {
        videoContainer.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1" frameborder="0" allowfullscreen></iframe>`;
      } else {
        videoContainer.innerHTML = `<video src="${video}" controls playsinline preload="metadata"></video>`;
      }
      videoContainer.style.display = 'block';
    } else {
      videoContainer.innerHTML = '';
      videoContainer.style.display = 'none';
    }

    // Timer bar
    const timerBar = document.getElementById('admin-timer-bar');
    timerBar.style.transition = 'none';
    timerBar.style.width = '100%';
    timerBar.offsetHeight;
    timerBar.style.transition = `width ${timeLimit}s linear`;
    timerBar.style.width = '0%';

    // Answer grid
    const grid = document.getElementById('admin-answer-grid');
    if (type === 'slider') {
      const s = currentQuestionData.slider || {};
      const unit = s.unit || '';
      grid.className = 'answer-grid cols-1';
      grid.innerHTML = `<div style="text-align:center;font-weight:700;opacity:0.7;font-size:1.2rem;">🎚️ Curseur : ${s.sliderMin}${unit} — ${s.sliderMax}${unit}</div>`;
    } else if (type === 'ordering') {
      grid.className = 'answer-grid cols-1';
      const items = currentQuestionData.orderingItems || [];
      grid.innerHTML = `<div style="text-align:center;font-weight:700;opacity:0.7;font-size:1.2rem;">📊 Classement - ${items.length} elements a ordonner</div>`;
    } else if (type === 'truefalse') {
      grid.className = 'answer-grid cols-1';
      grid.innerHTML = `
      <div class="answer-btn btn-green"><span class="shape">✅</span><span class="text">Vrai</span></div>
      <div class="answer-btn btn-red"><span class="shape">❌</span><span class="text">Faux</span></div>`;
    } else if (type === 'freetext') {
      grid.className = 'answer-grid cols-1';
      grid.innerHTML = `<div style="text-align:center;font-weight:700;opacity:0.7;font-size:1.2rem;">✏️ Réponse libre</div>`;
    } else {
      grid.className = 'answer-grid';
      grid.innerHTML = choices
        .map(
          (c, i) =>
            `<div class="answer-btn ${barColors[i] || 'btn-red'}"><span class="shape">${shapes[i] || ''}</span><span class="text">${c}</span></div>`,
        )
        .join('');
    }

    showScreen('questionDisplay');
  },
);

socket.on('game:timer-tick', ({ remaining }) => {
  const el = document.getElementById('admin-timer');
  if (el) el.textContent = remaining;
});

socket.on('game:answer-count', ({ answered, total }) => {
  document.getElementById('admin-answer-count').textContent = `${answered} / ${total} réponses`;
});

// ========== STATS ==========

socket.on('game:answer-stats', (stats) => {
  document.getElementById('stats-question').textContent = currentQuestionData.text;
  const freetextEl = document.getElementById('freetext-stats');
  const barsEl = document.getElementById('stats-bars');

  if (stats.type === 'slider') {
    barsEl.style.display = 'none';
    freetextEl.style.display = 'flex';
    const unit = stats.unit || '';
    const avg =
      stats.answers.length > 0
        ? (stats.answers.reduce((a, b) => a + b, 0) / stats.answers.length).toFixed(1)
        : '-';
    const tolMin = stats.correctValue - stats.tolerance;
    const tolMax = stats.correctValue + stats.tolerance;
    freetextEl.innerHTML = `
      <div style="text-align:center; width:100%;">
        <div style="font-size:1.3rem; font-weight:800; margin-bottom:10px;">🎚️ Bonne réponse : ${stats.correctValue}${unit}${stats.tolerance > 0 ? ` (± ${stats.tolerance})` : ''}</div>
        <div class="slider-stats-bar">
          <div class="slider-stats-track">
            <div class="slider-stats-zone" style="left:${((tolMin - stats.sliderMin) / (stats.sliderMax - stats.sliderMin)) * 100}%;width:${((tolMax - tolMin) / (stats.sliderMax - stats.sliderMin)) * 100}%"></div>
            ${stats.answers
              .map((v) => {
                const pct = ((v - stats.sliderMin) / (stats.sliderMax - stats.sliderMin)) * 100;
                const isOk = Math.abs(v - stats.correctValue) <= stats.tolerance;
                return `<div class="slider-stats-dot ${isOk ? 'ok' : 'ko'}" style="left:${pct}%" title="${v}${unit}"></div>`;
              })
              .join('')}
          </div>
          <div class="slider-stats-labels"><span>${stats.sliderMin}${unit}</span><span>${stats.sliderMax}${unit}</span></div>
        </div>
        <div style="margin-top:15px; font-weight:700;">Moyenne : ${avg}${unit} — ${stats.correctCount} / ${stats.totalAnswered} dans la zone</div>
      </div>`;
    document.getElementById('stats-total').textContent =
      `${stats.totalAnswered} / ${stats.total} réponses`;
  } else if (stats.type === 'ordering') {
    barsEl.style.display = 'none';
    freetextEl.style.display = 'flex';
    freetextEl.innerHTML = `
      <div style="text-align:center; width:100%;">
        <div style="font-size:1.3rem; font-weight:800; margin-bottom:10px;">📊 Bon ordre :</div>
        ${stats.items.map((item, i) => `<div style="padding:6px 0; font-weight:600;">${i + 1}. ${item}</div>`).join('')}
        <div style="margin-top:15px; font-weight:700;">${stats.correctCount} / ${stats.totalAnswered} ont trouvé le bon ordre</div>
      </div>`;
    document.getElementById('stats-total').textContent =
      `${stats.totalAnswered} / ${stats.total} réponses`;
  } else if (stats.type === 'freetext') {
    barsEl.style.display = 'none';
    freetextEl.style.display = 'flex';
    freetextEl.innerHTML = Object.entries(stats.answers)
      .sort((a, b) => b[1] - a[1])
      .map(([text, count]) => {
        const isCorrect = stats.acceptedAnswers.includes(text.toLowerCase());
        return `<div class="freetext-answer-chip ${isCorrect ? 'correct' : 'wrong'}">${text} (${count})</div>`;
      })
      .join('');
    document.getElementById('stats-total').textContent = '';
  } else {
    barsEl.style.display = 'flex';
    freetextEl.style.display = 'none';
    const maxCount = Math.max(...stats.counts, 1);

    barsEl.innerHTML = stats.counts
      .map((count, i) => {
        const heightPct = (count / maxCount) * 100;
        const isCorrect =
          stats.type === 'multi'
            ? (stats.correctIndices || []).includes(i)
            : i === stats.correctIndex;
        return `<div class="stat-bar-wrapper">
        <div class="stat-bar ${statBarColors[i] || 'bar-red'}${isCorrect ? ' correct-bar' : ''}" style="height: ${Math.max(heightPct, 8)}%">
          ${count}
        </div>
        <div class="stat-label">${shapes[i] || ''} ${currentQuestionData.choices[i] || ''}</div>
      </div>`;
      })
      .join('');

    const answered = stats.counts.reduce((a, b) => a + b, 0);
    document.getElementById('stats-total').textContent = `${answered} / ${stats.total} réponses`;
  }

  // Show explanation if present
  const explanationEl = document.getElementById('stats-explanation');
  if (stats.explanation) {
    explanationEl.textContent = '💡 ' + stats.explanation;
    explanationEl.style.display = 'block';
  } else {
    explanationEl.style.display = 'none';
  }

  showScreen('stats');
});

document.getElementById('show-leaderboard-btn').addEventListener('click', () => {
  socket.emit('admin:show-leaderboard', { pin: currentPin });
});

// ========== LEADERBOARD ==========

socket.on('game:leaderboard', ({ rankings }) => {
  renderAdminLeaderboard(rankings);
  showScreen('leaderboard');
});

function renderAdminLeaderboard(rankings) {
  document.getElementById('admin-rankings').innerHTML = rankings
    .map((r, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      return `<div class="leaderboard-row" style="animation-delay: ${i * 0.08}s">
      <div class="avatar" style="background:${r.avatar?.color || '#666'}">${r.avatar?.icon || '👤'}</div>
      <div class="rank ${rankClass}">${r.rank}</div>
      <div class="name">${r.nickname}${r.streak > 1 ? `<span class="streak-badge">🔥${r.streak}</span>` : ''}</div>
      <div class="score">${r.score}</div>
    </div>`;
    })
    .join('');
}

// Reactions display
socket.on('game:reaction', ({ nickname, emoji, avatar }) => {
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;
  el.style.left = Math.random() * 80 + 10 + '%';
  el.style.bottom = '20%';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

document.getElementById('next-question-btn').addEventListener('click', () => {
  socket.emit('admin:next-question', { pin: currentPin });
});

// ========== PAUSE ==========

window.togglePause = function () {
  socket.emit('admin:toggle-pause', { pin: currentPin });
};

socket.on('game:paused', () => {
  document.getElementById('pause-overlay').style.display = 'flex';
});

socket.on('game:resumed', () => {
  document.getElementById('pause-overlay').style.display = 'none';
});

document.getElementById('resume-btn').addEventListener('click', () => {
  socket.emit('admin:toggle-pause', { pin: currentPin });
});

// ========== FINAL ==========

socket.on('game:finished', ({ podium, rankings, dashboard }) => {
  renderAdminPodium(podium);
  renderAdminFinalRankings(rankings);
  if (dashboard) renderDashboard(dashboard);
  showScreen('final');
  startConfetti();
  sessionStorage.removeItem('alihoot-admin');
});

// ========== DASHBOARD ==========

document.getElementById('toggle-dashboard-btn').addEventListener('click', () => {
  const section = document.getElementById('dashboard-section');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
});

function renderDashboard(data) {
  const grid = document.getElementById('dashboard-grid');
  document.getElementById('dashboard-section').style.display = 'none';

  let html = '';

  // Hardest question
  if (data.hardestQuestion) {
    html += `<div class="dashboard-card">
      <div class="dashboard-card-icon">💀</div>
      <div class="dashboard-card-label">Question la plus ratée</div>
      <div class="dashboard-card-value">${data.hardestQuestion.text}</div>
      <div class="dashboard-card-detail">${data.hardestQuestion.correctPct}% de bonnes réponses</div>
    </div>`;
  }

  // Easiest question
  if (data.easiestQuestion) {
    html += `<div class="dashboard-card">
      <div class="dashboard-card-icon">🎯</div>
      <div class="dashboard-card-label">Question la plus réussie</div>
      <div class="dashboard-card-value">${data.easiestQuestion.text}</div>
      <div class="dashboard-card-detail">${data.easiestQuestion.correctPct}% de bonnes réponses</div>
    </div>`;
  }

  // Average response time
  if (data.avgResponseTime != null) {
    html += `<div class="dashboard-card">
      <div class="dashboard-card-icon">⏱️</div>
      <div class="dashboard-card-label">Temps moyen de réponse</div>
      <div class="dashboard-card-value">${data.avgResponseTime}s</div>
    </div>`;
  }

  // Fastest player
  if (data.fastestPlayer) {
    html += `<div class="dashboard-card">
      <div class="dashboard-card-icon">⚡</div>
      <div class="dashboard-card-label">Joueur le plus rapide</div>
      <div class="dashboard-card-value">${data.fastestPlayer.nickname}</div>
      <div class="dashboard-card-detail">${data.fastestPlayer.avgTime}s en moyenne</div>
    </div>`;
  }

  // Best streak
  if (data.bestStreak) {
    html += `<div class="dashboard-card">
      <div class="dashboard-card-icon">🔥</div>
      <div class="dashboard-card-label">Meilleure série</div>
      <div class="dashboard-card-value">${data.bestStreak.count} d'affilée</div>
      <div class="dashboard-card-detail">par ${data.bestStreak.nickname}</div>
    </div>`;
  }

  // Total correct answers
  if (data.totalCorrect != null) {
    html += `<div class="dashboard-card">
      <div class="dashboard-card-icon">✅</div>
      <div class="dashboard-card-label">Bonnes réponses totales</div>
      <div class="dashboard-card-value">${data.totalCorrect} / ${data.totalAnswers}</div>
      <div class="dashboard-card-detail">${data.totalCorrectPct}% global</div>
    </div>`;
  }

  // Per-question breakdown
  if (data.perQuestion && data.perQuestion.length > 0) {
    html += `<div class="dashboard-card dashboard-card-wide">
      <div class="dashboard-card-icon">📊</div>
      <div class="dashboard-card-label">Taux de réussite par question</div>
      <div class="dashboard-breakdown">
        ${data.perQuestion
          .map((pq, i) => {
            const barWidth = Math.max(pq.correctPct, 5);
            const barColor =
              pq.correctPct >= 70
                ? 'var(--green)'
                : pq.correctPct >= 40
                  ? 'var(--yellow)'
                  : 'var(--red)';
            return `<div class="breakdown-row">
            <span class="breakdown-label">Q${i + 1}</span>
            <div class="breakdown-bar-bg"><div class="breakdown-bar" style="width:${barWidth}%;background:${barColor};"></div></div>
            <span class="breakdown-pct">${pq.correctPct}%</span>
          </div>`;
          })
          .join('')}
      </div>
    </div>`;
  }

  grid.innerHTML = html;
}

function renderAdminPodium(podium) {
  const el = document.getElementById('admin-podium');
  const order = [1, 0, 2];
  const classes = ['second', 'first', 'third'];
  const medals = ['🥈', '🥇', '🥉'];

  el.innerHTML = order
    .map((idx, i) => {
      const p = podium[idx];
      if (!p) return '';
      return `<div class="podium-place">
      <div class="podium-avatar">${p.avatar?.icon || '👤'}</div>
      <div class="podium-name">${p.nickname}</div>
      <div class="podium-score">${p.score} pts</div>
      <div class="podium-block ${classes[i]}">${medals[i]}</div>
    </div>`;
    })
    .join('');
}

function renderAdminFinalRankings(rankings) {
  document.getElementById('admin-final-rankings').innerHTML = rankings
    .map((r, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      return `<div class="leaderboard-row" style="animation-delay: ${i * 0.06}s">
      <div class="avatar" style="background:${r.avatar?.color || '#666'}">${r.avatar?.icon || '👤'}</div>
      <div class="rank ${rankClass}">${r.rank}</div>
      <div class="name">${r.nickname}</div>
      <div class="score">${r.score}</div>
    </div>`;
    })
    .join('');
}

// ========== SHARE RESULTS ==========

document.getElementById('share-btn').addEventListener('click', async () => {
  const el = document.getElementById('final-screen');
  const canvas = document.getElementById('confetti-canvas');
  canvas.style.display = 'none';
  try {
    if (typeof html2canvas !== 'undefined') {
      const c = await html2canvas(el, { backgroundColor: '#46178f', scale: 2 });
      c.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `alihoot-resultats-${currentPin}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  } catch (e) {
    console.error('Share failed', e);
  }
  canvas.style.display = '';
});

document.getElementById('back-home-btn').addEventListener('click', () => {
  window.location.reload();
});

// Init auth
AdminAuth.init();
