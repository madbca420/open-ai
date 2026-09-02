import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const CURRENT_SCHEMA_VERSION = 4;

export function runDatabaseMigrations(db: Database.Database, dbPath: string): void {
  console.log('[DB Migration] Checking database migrations...');

  // 1. Create schema_version tracking table if not present
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      description TEXT NOT NULL
    );
  `);

  const currentVersionRow = db
    .prepare('SELECT MAX(version) as version FROM schema_version')
    .get() as { version: number | null } | undefined;

  const activeVersion = currentVersionRow?.version ?? 0;
  console.log(`[DB Migration] Current database version: ${activeVersion}, target version: ${CURRENT_SCHEMA_VERSION}`);

  if (activeVersion >= CURRENT_SCHEMA_VERSION) {
    console.log('[DB Migration] Database schema is up to date.');
    return;
  }

  // 2. Perform backup before applying migrations if database file exists
  if (fs.existsSync(dbPath)) {
    try {
      const backupPath = `${dbPath}.bak.${Date.now()}`;
      fs.copyFileSync(dbPath, backupPath);
      console.log(`[DB Migration] Backup created at ${backupPath}`);
    } catch (backupErr) {
      console.warn('[DB Migration] Database backup creation warning:', backupErr);
    }
  }

  // 3. Sequential Migration Execution inside SQLite Transaction
  if (activeVersion < 1) {
    console.log('[DB Migration] Applying Migration v1 (JARVIS Master Foundation Tables)...');

    const migrateV1 = db.transaction(() => {
      // Missions Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS missions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          workspace TEXT NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT
        );
      `);

      // Tasks Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          parent_task_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          assigned_agent TEXT,
          assigned_model TEXT,
          status TEXT NOT NULL,
          start_time DATETIME,
          end_time DATETIME,
          input TEXT,
          output TEXT,
          error TEXT,
          artifacts TEXT,
          FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
        );
      `);

      // Task Dependencies Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_dependencies (
          task_id TEXT NOT NULL,
          depends_on_task_id TEXT NOT NULL,
          PRIMARY KEY (task_id, depends_on_task_id),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
      `);

      // Agents Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          assigned_model TEXT,
          state TEXT NOT NULL,
          last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Canonical Events Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          category TEXT NOT NULL,
          source TEXT NOT NULL,
          mission_id TEXT,
          task_id TEXT,
          agent_id TEXT,
          workspace TEXT,
          severity TEXT DEFAULT 'INFO',
          payload TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Artifacts Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          checksum TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_by TEXT NOT NULL,
          mission_id TEXT,
          task_id TEXT,
          metadata TEXT
        );
      `);

      // Skills Registry Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          version TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          permission_level INTEGER DEFAULT 0
        );
      `);

      // Memory Records Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_records (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          session_id TEXT,
          key TEXT,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Risk Logs Table (Trading Security Contract)
      db.exec(`
        CREATE TABLE IF NOT EXISTS risk_logs (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          approved INTEGER NOT NULL,
          reason TEXT NOT NULL,
          risk_score REAL NOT NULL,
          evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Trading Analyses Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS trading_analyses (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          action TEXT NOT NULL,
          confidence REAL NOT NULL,
          conviction INTEGER NOT NULL,
          decision_payload TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Processes Supervisor Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS processes (
          process_id TEXT PRIMARY KEY,
          pid INTEGER,
          type TEXT NOT NULL,
          command TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ended_at DATETIME,
          exit_code INTEGER,
          mission_id TEXT,
          task_id TEXT
        );
      `);

      // Register migration v1 entry
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        1,
        'JARVIS Master Foundation Tables (Missions, Tasks, Events, Artifacts, Skills, Memory, RiskLogs, Processes)'
      );
    });

    migrateV1();
    console.log('[DB Migration] Migration v1 applied successfully.');
  }

  if (activeVersion < 2) {
    console.log('[DB Migration] Applying Migration v2 (JARVIS Phase 4 Adapter Infrastructure Tables)...');

    const migrateV2 = db.transaction(() => {
      // 1. Adapters Registry Metadata Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS adapters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          version TEXT,
          status TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          last_health_check DATETIME,
          last_error TEXT,
          metadata TEXT
        );
      `);

      // 2. Adapter Execution Tracking Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS adapter_runs (
          id TEXT PRIMARY KEY,
          adapter_id TEXT NOT NULL,
          mission_id TEXT,
          task_id TEXT,
          input TEXT,
          output TEXT,
          status TEXT NOT NULL,
          started_at DATETIME,
          ended_at DATETIME,
          error TEXT,
          FOREIGN KEY (adapter_id) REFERENCES adapters(id) ON DELETE CASCADE
        );
      `);

      // 3. Adapter Health Check History Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS adapter_health (
          id TEXT PRIMARY KEY,
          adapter_id TEXT NOT NULL,
          checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          is_healthy INTEGER NOT NULL,
          latency_ms INTEGER,
          error TEXT,
          FOREIGN KEY (adapter_id) REFERENCES adapters(id) ON DELETE CASCADE
        );
      `);

      // 4. Adapter Feature Flags & Safe Configuration Table
      db.exec(`
        CREATE TABLE IF NOT EXISTS adapter_config (
          adapter_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (adapter_id, key)
        );
      `);

      // 5. Create Targeted Performance Indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_adapter_runs_adapter ON adapter_runs(adapter_id);
        CREATE INDEX IF NOT EXISTS idx_adapter_runs_mission ON adapter_runs(mission_id);
        CREATE INDEX IF NOT EXISTS idx_adapter_runs_task ON adapter_runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_adapter_health_adapter ON adapter_health(adapter_id);
        CREATE INDEX IF NOT EXISTS idx_adapter_health_checked ON adapter_health(checked_at);
        CREATE INDEX IF NOT EXISTS idx_adapter_config_adapter ON adapter_config(adapter_id);
      `);

      // Register migration v2 entry
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        2,
        'JARVIS Phase 4 Adapter Infrastructure Tables (adapters, adapter_runs, adapter_health, adapter_config + indexes)'
      );
    });

    migrateV2();
    console.log('[DB Migration] Migration v2 applied successfully.');
  }

  if (activeVersion < 3) {
    console.log('[DB Migration] Applying Migration v3 (conversation_memory.session_id column)...');

    const migrateV3 = db.transaction(() => {
      // Detect whether session_id already exists in conversation_memory
      // (It exists if the table was created fresh from db.ts CREATE TABLE IF NOT EXISTS)
      const tableInfo = db.prepare("PRAGMA table_info(conversation_memory)").all() as Array<{ name: string }>;
      const hasSessionId = tableInfo.some((col) => col.name === 'session_id');

      if (!hasSessionId) {
        // Add session_id to existing tables without the column.
        // Default '' for existing rows (treated as legacy/unknown session).
        db.exec(`ALTER TABLE conversation_memory ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`);
        // Create index for efficient session-based queries
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_memory_session ON conversation_memory(session_id)`);
        console.log('[DB Migration] v3: Added session_id column to conversation_memory.');
      } else {
        console.log('[DB Migration] v3: conversation_memory.session_id already present, skipping ALTER.');
        // Still create index if it doesn't exist
        db.exec(`CREATE INDEX IF NOT EXISTS idx_conversation_memory_session ON conversation_memory(session_id)`);
      }

      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        3,
        'Add session_id column to conversation_memory for session-aware chat memory'
      );
    });

    migrateV3();
    console.log('[DB Migration] Migration v3 applied successfully.');
  }

  if (activeVersion < 4) {
    console.log('[DB Migration] Applying Migration v4 (Website Builder Projects Registry)...');

    const migrateV4 = db.transaction(() => {
      // Projects table — tracks every generated project
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          project_dir TEXT NOT NULL,
          project_type TEXT DEFAULT 'fullstack',
          status TEXT DEFAULT 'CREATED',
          frontend_port INTEGER,
          backend_port INTEGER,
          frontend_url TEXT,
          backend_url TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // Project logs table — streaming build/runtime logs per project
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          level TEXT DEFAULT 'INFO',
          message TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `);

      // Indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE INDEX IF NOT EXISTS idx_project_logs_project ON project_logs(project_id);
      `);

      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        4,
        'Website Builder Projects Registry (projects, project_logs tables)'
      );
    });

    migrateV4();
    console.log('[DB Migration] Migration v4 applied successfully.');
  }
}

