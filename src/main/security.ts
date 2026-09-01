import crypto from 'crypto';
import os from 'os';

// Derive a 256-bit encryption key bound to machine context + app identifier
const APP_SALT = 'jarvis-scifi-ai-assistant-salt-v1';
const machineId = os.hostname() + os.homedir() + os.arch();
const MASTER_KEY = crypto.scryptSync(machineId, APP_SALT, 32);

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  encryptedData: string;
}

export function encryptString(text: string): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    authTag,
    encryptedData: encrypted,
  };
}

export function decryptString(payload: EncryptedPayload): string {
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
  
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(payload.encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Sanitizes any error message to ensure raw API keys (sk-..., gsk-..., etc.) are completely redacted.
 */
export function sanitizeErrorMessage(error: any): string {
  const message = typeof error === 'string' ? error : error?.message || String(error);
  // Redact potential API keys matching common key formats (sk-..., gsk-..., AIzaSy...)
  return message
    .replace(/(sk-proj-[A-Za-z0-9_-]{20,})/g, 'sk-proj-[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, 'sk-[REDACTED]')
    .replace(/(AIzaSy[A-Za-z0-9_-]{20,})/g, 'AIzaSy[REDACTED]')
    .replace(/(gsk_[A-Za-z0-9_-]{20,})/g, 'gsk_[REDACTED]');
}
