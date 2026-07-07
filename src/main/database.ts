import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import type { Database, SqlValue } from "sql.js";

const APP_DATA_FOLDER = "ProjectBoard";

export class LocalDatabase {
  private constructor(
    private readonly db: Database,
    readonly dataDir: string,
    readonly dataPath: string,
    readonly backupDir: string
  ) {}

  static async open(): Promise<LocalDatabase> {
    const localRoot = process.env.LOCALAPPDATA || app.getPath("userData");
    const dataDir = path.join(localRoot, APP_DATA_FOLDER);
    const backupDir = path.join(dataDir, "backups", "manual");
    const dataPath = path.join(dataDir, "workspace.sqlite");

    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(path.join(dataDir, "attachments", "copied"), { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(path.join(dataDir, "exports"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "logs"), { recursive: true });

    const wasmDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
    const SQL = await initSqlJs({
      locateFile: (file) => path.join(wasmDir, file)
    });

    const db = fsSync.existsSync(dataPath)
      ? new SQL.Database(await fs.readFile(dataPath))
      : new SQL.Database();

    const store = new LocalDatabase(db, dataDir, dataPath, backupDir);
    store.db.run("PRAGMA foreign_keys = ON");
    store.initializeSchema();
    store.ensureWorkspace();
    await store.persist();

    return store;
  }

  all<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql);
    const rows: T[] = [];

    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
    } finally {
      statement.free();
    }

    return rows;
  }

  get<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  run(sql: string, params: SqlValue[] = []): void {
    this.db.run(sql, params);
  }

  async write<T>(operation: () => T): Promise<T> {
    this.db.run("BEGIN IMMEDIATE TRANSACTION");

    try {
      const result = operation();
      this.db.run("COMMIT");
      await this.persist();
      return result;
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  async persist(): Promise<void> {
    const data = Buffer.from(this.db.export());
    const tmpPath = `${this.dataPath}.tmp`;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, this.dataPath);
  }

  async createManualBackup(): Promise<string> {
    await this.persist();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(this.backupDir, `workspace-${timestamp}.sqlite`);
    await fs.copyFile(this.dataPath, backupPath);
    return backupPath;
  }

  private ensureWorkspace(): void {
    const existing = this.get("SELECT id FROM workspaces LIMIT 1");
    if (existing) {
      return;
    }

    const now = new Date().toISOString();
    this.run(
      "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [randomUUID(), "Local Workspace", now, now]
    );
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        icon TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id),
        name TEXT NOT NULL,
        position TEXT NOT NULL,
        color TEXT,
        is_completion_column INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        board_id TEXT NOT NULL REFERENCES boards(id),
        column_id TEXT NOT NULL REFERENCES columns(id),
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT,
        due_date TEXT,
        position TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        color TEXT,
        description TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, name)
      );

      CREATE TABLE IF NOT EXISTS card_tags (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(card_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS checklist_items (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        is_complete INTEGER NOT NULL DEFAULT 0,
        position TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        original_name TEXT,
        storage_mode TEXT NOT NULL,
        path TEXT,
        mime_type TEXT,
        size_bytes INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        template_type TEXT NOT NULL,
        name TEXT NOT NULL,
        body_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_boards_project ON boards(project_id);
      CREATE INDEX IF NOT EXISTS idx_columns_board_position ON columns(board_id, position);
      CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id);
      CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id);
      CREATE INDEX IF NOT EXISTS idx_cards_column_position ON cards(column_id, position);
      CREATE INDEX IF NOT EXISTS idx_cards_due_date ON cards(due_date);
      CREATE INDEX IF NOT EXISTS idx_tags_project_name ON tags(project_id, name);
      CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_comments_card_created ON comments(card_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_checklist_card_position ON checklist_items(card_id, position);
      CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id);
      CREATE INDEX IF NOT EXISTS idx_activity_project_created ON activity_events(project_id, created_at);
    `);
  }
}
