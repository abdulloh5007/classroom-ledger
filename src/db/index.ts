import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 4) {
    db.close();
    throw new Error('Версия БД новее приложения');
  }
  if (version < 1)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, phone TEXT NOT NULL, group_name TEXT NOT NULL,
        monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount) = 'integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL CHECK(typeof(amount) = 'integer' AND amount BETWEEN 1 AND 1000000000000),
        paid_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX payments_student_date ON payments(student_id, paid_at);
      CREATE TABLE admins (
        telegram_id INTEGER PRIMARY KEY, added_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE bot_receipts (
        request_key TEXT PRIMARY KEY,
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE
      );
      PRAGMA user_version = 1;
    `);
    })();
  if (version < 2)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE web_sessions (
          token_hash TEXT PRIMARY KEY,
          credential_version TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX web_sessions_expiry ON web_sessions(expires_at);
        PRAGMA user_version = 2;
      `);
    })();
  if (version < 3)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE login_attempts (
          key TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
        PRAGMA user_version = 3;
      `);
    })();
  if (version < 4)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
          monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount)='integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(name, monthly_amount)
        );
        ALTER TABLE students ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE RESTRICT;
        INSERT INTO courses(name, monthly_amount) SELECT DISTINCT group_name, monthly_amount FROM students ORDER BY group_name, monthly_amount;
        UPDATE students SET course_id=(SELECT id FROM courses WHERE name=students.group_name AND monthly_amount=students.monthly_amount);
        CREATE INDEX students_course ON students(course_id);
        CREATE TRIGGER course_student_tariff AFTER UPDATE OF name, monthly_amount ON courses BEGIN
          UPDATE students SET group_name=NEW.name, monthly_amount=NEW.monthly_amount WHERE course_id=NEW.id;
        END;
        PRAGMA user_version = 4;
      `);
    })();
  return db;
}
