import { getDatabase } from './db';
import { encryptString, decryptString, sanitizeErrorMessage, EncryptedPayload } from './security';

export type Provider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'omniroute';

export interface KeyVaultEntry {
  provider: Provider;
  hasKey: boolean;
}

/**
 * Saves an encrypted API key to SQLite. The raw key value never touches disk.
 */
export function saveApiKey(provider: Provider, rawKey: string): void {
  const db = getDatabase();
  const encrypted = encryptString(rawKey);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO encrypted_keys (provider, iv, auth_tag, encrypted_data, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run(provider, encrypted.iv, encrypted.authTag, encrypted.encryptedData);

  // Audit log (never includes the key value itself)
  db.prepare(`INSERT INTO system_audit_logs (action_type, details, status) VALUES (?, ?, ?)`)
    .run('KEY_SAVED', `Provider: ${provider}`, 'SUCCESS');
}

/**
 * Retrieves and decrypts an API key from SQLite.
 * Throws a sanitized error on decryption failure.
 */
export function getApiKey(provider: Provider): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT iv, auth_tag, encrypted_data FROM encrypted_keys WHERE provider = ?')
    .get(provider) as { iv: string; auth_tag: string; encrypted_data: string } | undefined;

  if (!row) return null;

  try {
    const payload: EncryptedPayload = {
      iv: row.iv,
      authTag: row.auth_tag,
      encryptedData: row.encrypted_data,
    };
    return decryptString(payload);
  } catch (err) {
    const safe = sanitizeErrorMessage(err);
    console.error(`[KeyVault] Decryption failed for provider ${provider}: ${safe}`);
    throw new Error(`Failed to decrypt key for provider "${provider}". It may have been set on a different machine.`);
  }
}

/**
 * Deletes an API key for a provider.
 */
export function deleteApiKey(provider: Provider): void {
  const db = getDatabase();
  db.prepare('DELETE FROM encrypted_keys WHERE provider = ?').run(provider);
  db.prepare(`INSERT INTO system_audit_logs (action_type, details, status) VALUES (?, ?, ?)`)
    .run('KEY_DELETED', `Provider: ${provider}`, 'SUCCESS');
}

/**
 * Returns which providers have a key stored (without revealing the keys).
 */
export function listStoredProviders(): KeyVaultEntry[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT provider FROM encrypted_keys').all() as { provider: Provider }[];
  const stored = new Set(rows.map(r => r.provider));
  const all: Provider[] = ['anthropic', 'openai', 'google', 'ollama', 'omniroute'];
  // ollama and omniroute work without API keys (local/free-tier); report hasKey=true so the UI
  // shows them as usable even when no key is configured in the vault.
  return all.map(p => ({ provider: p, hasKey: p === 'ollama' || p === 'omniroute' || stored.has(p) }));
}
