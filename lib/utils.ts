import crypto from 'crypto';
import { Avatar } from './types';

export function generatePin(existingPins: Set<string>): string {
  let pin: string;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (existingPins.has(pin));
  return pin;
}

export function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function sanitize(str: string, maxLength = 500): string {
  if (typeof str !== 'string') return '';
  return (
    str
      // Remove null bytes and control characters (except newlines/tabs)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Strip HTML tags to prevent XSS (but keep the text content)
      .replace(/<[^>]*>/g, '')
      .trim()
      .slice(0, maxLength)
  );
}

// Validate URL format (only http/https)
export function sanitizeUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https?:\/\/.+/i.test(trimmed)) return null;
  return sanitize(trimmed, 2000);
}

const AVATAR_ICONS = [
  '🐱', '🐶', '🦊', '🐸', '🐵', '🦁', '🐼', '🐨', '🐯', '🦄',
  '🐙', '🦋', '🐢', '🦖', '🐳', '🦩', '🦀', '🐝', '🦜', '🐺',
];

const AVATAR_COLORS = [
  '#e21b3c', '#1368ce', '#d89e00', '#26890c', '#9b59b6', '#e67e22',
  '#1abc9c', '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#8e44ad',
  '#16a085', '#c0392b', '#2980b9', '#27ae60',
];

export function generateAvatar(): Avatar {
  const icon = AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)];
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  return { icon, color };
}
