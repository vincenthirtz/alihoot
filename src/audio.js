// Audio system using Web Audio API - generates sounds programmatically
let ctx = null;
let enabled = true;
let musicEnabled = true;
let lobbyOsc = null;
let lobbyGain = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function playTone(freq, duration, type = 'sine', volume = 0.3) {
  if (!enabled) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function playSequence(notes, interval = 0.15) {
  if (!enabled) return;
  notes.forEach(([freq, dur, type], i) => {
    setTimeout(() => playTone(freq, dur || 0.3, type || 'sine', 0.25), i * interval * 1000);
  });
}

const sounds = {
  'question-start': () => {
    playSequence([[523, 0.15, 'square'], [659, 0.15, 'square'], [784, 0.3, 'square']], 0.12);
  },
  'tick': () => playTone(800, 0.08, 'sine', 0.15),
  'time-up': () => playSequence([[400, 0.2, 'sawtooth'], [300, 0.3, 'sawtooth']], 0.2),
  'correct': () => playSequence([[523, 0.1, 'sine'], [659, 0.1, 'sine'], [784, 0.2, 'sine']], 0.1),
  'wrong': () => playSequence([[300, 0.15, 'sawtooth'], [250, 0.3, 'sawtooth']], 0.15),
  'leaderboard': () => playSequence([[392, 0.15, 'triangle'], [440, 0.15, 'triangle'], [523, 0.15, 'triangle'], [659, 0.25, 'triangle']], 0.12),
  'victory': () => playSequence([[523, 0.15, 'square'], [587, 0.15, 'square'], [659, 0.15, 'square'], [784, 0.15, 'square'], [880, 0.15, 'square'], [1047, 0.4, 'square']], 0.12),
  'join': () => playTone(880, 0.15, 'sine', 0.15),
  'countdown': () => playTone(600, 0.2, 'triangle', 0.2),
  'click': () => playTone(1000, 0.05, 'sine', 0.1),
};

function startLobbyMusic() {
  if (!musicEnabled) return;
  const c = getCtx();
  lobbyGain = c.createGain();
  lobbyGain.gain.setValueAtTime(0.08, c.currentTime);
  lobbyGain.connect(c.destination);

  const notes = [392, 440, 523, 440, 392, 349, 392, 440, 523, 659, 587, 523, 440, 392, 349, 330];
  let noteIndex = 0;

  function playNote() {
    if (!lobbyOsc) return;
    const freq = notes[noteIndex % notes.length];
    lobbyOsc.frequency.setValueAtTime(freq, c.currentTime);
    noteIndex++;
  }

  lobbyOsc = c.createOscillator();
  lobbyOsc.type = 'triangle';
  lobbyOsc.connect(lobbyGain);
  lobbyOsc.start();

  const interval = setInterval(() => {
    if (!lobbyOsc) { clearInterval(interval); return; }
    playNote();
  }, 400);

  lobbyOsc._interval = interval;
  playNote();
}

function stopLobbyMusic() {
  if (lobbyOsc) {
    clearInterval(lobbyOsc._interval);
    lobbyOsc.stop();
    lobbyOsc = null;
  }
  if (lobbyGain) {
    lobbyGain.disconnect();
    lobbyGain = null;
  }
}

function play(name) {
  if (!enabled) return;
  if (sounds[name]) sounds[name]();
}

// Tension music during questions — rhythmic pulse that speeds up
let tensionOsc = null;
let tensionGain = null;
let tensionInterval = null;
let tensionBpm = 90;

function startTensionMusic(duration = 20) {
  if (!musicEnabled) return;
  stopTensionMusic();
  const c = getCtx();
  tensionGain = c.createGain();
  tensionGain.gain.setValueAtTime(0.06, c.currentTime);
  tensionGain.connect(c.destination);

  tensionOsc = c.createOscillator();
  tensionOsc.type = 'square';
  tensionOsc.frequency.setValueAtTime(110, c.currentTime);
  tensionOsc.connect(tensionGain);
  tensionOsc.start();

  const pattern = [110, 0, 165, 0, 110, 0, 220, 0];
  let noteIdx = 0;
  tensionBpm = 90;
  const startTime = Date.now();

  tensionInterval = setInterval(() => {
    if (!tensionOsc) { clearInterval(tensionInterval); return; }
    const elapsed = (Date.now() - startTime) / 1000;
    const progress = Math.min(elapsed / duration, 1);
    // Speed up as time runs out
    tensionBpm = 90 + progress * 90;
    // Volume increases too
    if (tensionGain) tensionGain.gain.setValueAtTime(0.06 + progress * 0.04, c.currentTime);

    const freq = pattern[noteIdx % pattern.length];
    if (tensionOsc) {
      tensionOsc.frequency.setValueAtTime(freq || 0.001, c.currentTime);
    }
    noteIdx++;
  }, () => 60000 / tensionBpm / 2);

  // Use fixed interval that adapts
  clearInterval(tensionInterval);
  function tick() {
    if (!tensionOsc) return;
    const elapsed = (Date.now() - startTime) / 1000;
    const progress = Math.min(elapsed / duration, 1);
    tensionBpm = 90 + progress * 90;
    if (tensionGain) {
      try { tensionGain.gain.setValueAtTime(0.06 + progress * 0.04, c.currentTime); } catch {}
    }
    const freq = pattern[noteIdx % pattern.length];
    if (tensionOsc) {
      try { tensionOsc.frequency.setValueAtTime(freq || 0.001, c.currentTime); } catch {}
    }
    noteIdx++;
    tensionInterval = setTimeout(tick, 60000 / tensionBpm / 2);
  }
  tensionInterval = setTimeout(tick, 60000 / tensionBpm / 2);
}

function stopTensionMusic() {
  if (tensionInterval) { clearTimeout(tensionInterval); tensionInterval = null; }
  if (tensionOsc) { try { tensionOsc.stop(); } catch {} tensionOsc = null; }
  if (tensionGain) { tensionGain.disconnect(); tensionGain = null; }
}

function toggle(state) {
  enabled = state;
  if (!state) { stopLobbyMusic(); stopTensionMusic(); }
}

function toggleMusic(state) {
  musicEnabled = state;
  if (!state) { stopLobbyMusic(); stopTensionMusic(); }
}

export const AudioSystem = { play, toggle, toggleMusic, startLobbyMusic, stopLobbyMusic, startTensionMusic, stopTensionMusic, getCtx };
