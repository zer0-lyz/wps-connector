import initSqlJs from "sql.js";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
let sqlPromise;

function sqlRuntime() {
  sqlPromise ||= initSqlJs({ locateFile: () => wasmPath });
  return sqlPromise;
}

async function isFile(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function bindStatement(statement, params) {
  if (params == null) return;
  statement.bind(params);
}

class SqliteStore {
  constructor(path, db, { readonly = false } = {}) {
    this.path = path;
    this.db = db;
    this.readonly = readonly;
    this.dirty = false;
    this.closed = false;
  }

  async execute(sql, params) {
    if (this.readonly) throw new Error(`SQLite database is read-only: ${this.path}`);
    this.db.run(sql, params);
    this.dirty = true;
    return { changes: this.db.getRowsModified() };
  }

  query(sql, params) {
    const statement = this.db.prepare(sql);
    try {
      bindStatement(statement, params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  queryReadonly(sql, params) {
    return this.query(sql, params);
  }

  async transaction(callback) {
    if (this.readonly) throw new Error(`SQLite database is read-only: ${this.path}`);
    await this.execute("BEGIN");
    try {
      const result = await callback(this);
      await this.execute("COMMIT");
      return result;
    } catch (error) {
      try { this.db.run("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (!this.readonly && this.dirty) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporaryPath = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
        try {
          await writeFile(temporaryPath, Buffer.from(this.db.export()));
          await rename(temporaryPath, this.path);
        } finally {
          try { await unlink(temporaryPath); } catch { /* already renamed */ }
        }
      }
    } finally {
      this.db.close();
    }
  }
}

export async function openDatabase(path, options = {}) {
  const databasePath = String(path || "");
  if (!databasePath) throw new Error("SQLite database path is required.");
  const readonly = Boolean(options.readonly);
  const SQL = await sqlRuntime();
  let bytes;
  try {
    bytes = await readFile(databasePath);
  } catch (error) {
    if (error.code !== "ENOENT" || readonly) throw error;
  }
  return new SqliteStore(databasePath, bytes ? new SQL.Database(bytes) : new SQL.Database(), { readonly });
}

export async function closeDatabase(database) {
  return database?.close();
}

export async function queryRows(path, sql, params, options = {}) {
  const database = await openDatabase(path, { readonly: options.readonly !== false });
  try {
    return options.readonly === false
      ? database.query(sql, params)
      : database.queryReadonly(sql, params);
  } finally {
    await database.close();
  }
}

export async function queryReadonly(path, sql, params) {
  return queryRows(path, sql, params, { readonly: true });
}

export async function execute(path, sql, params) {
  const database = await openDatabase(path);
  try {
    return await database.execute(sql, params);
  } finally {
    await database.close();
  }
}

export async function ensureSchema(path, sql) {
  return execute(path, sql);
}

export { SqliteStore };
