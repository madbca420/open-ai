import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { runDatabaseMigrations } from './dbMigrations';

let db: Database.Database | null = null;

export function initDatabase() {
  const dbDir = app.isPackaged ? app.getPath('userData') : process.cwd();
  const dbPath = path.join(dbDir, 'assistant_data.db');

  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS encrypted_keys (
      provider TEXT PRIMARY KEY,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run schema version migrations safely
  runDatabaseMigrations(db, dbPath);

  const insertStmt = db.prepare('INSERT OR IGNORE INTO system_audit_logs (action_type, details, status) VALUES (?, ?, ?)');
  insertStmt.run('DB_INIT', 'Database initialized successfully', 'SUCCESS');

  const countResult = (db.prepare('SELECT COUNT(*) as count FROM system_audit_logs').get() as { count: number });
  console.log(`[SQLite] Initialized at ${dbPath}. Audit log count: ${countResult.count}`);
  return { dbPath, count: countResult.count };
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}
