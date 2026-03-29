const crypto = require('crypto');

function generatePin(existingPins) {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (existingPins.has(pin));
  return pin;
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
}

const AVATAR_ICONS = ['🐱', '🐶', '🦊', '🐸', '🐵', '🦁', '🐼', '🐨', '🐯', '🦄', '🐙', '🦋', '🐢', '🦖', '🐳', '🦩', '🦀', '🐝', '🦜', '🐺'];
const AVATAR_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#9b59b6', '#e67e22', '#1abc9c', '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#8e44ad', '#16a085', '#c0392b', '#2980b9', '#27ae60'];

function generateAvatar(existingAvatars) {
  const icon = AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)];
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  return { icon, color };
}

module.exports = { generatePin, generateId, generateToken, sanitize, generateAvatar };
