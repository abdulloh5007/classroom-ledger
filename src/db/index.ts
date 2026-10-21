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
  if (version > 10) {
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
  if (version < 5)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE student_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(name, course_id)
        );
        ALTER TABLE students ADD COLUMN group_id INTEGER REFERENCES student_groups(id) ON DELETE RESTRICT;
        INSERT INTO student_groups(name, course_id) SELECT DISTINCT group_name, course_id FROM students ORDER BY group_name, course_id;
        UPDATE students SET group_id=(SELECT id FROM student_groups WHERE name=students.group_name AND course_id=students.course_id);
        CREATE INDEX students_group ON students(group_id);
        CREATE INDEX groups_course ON student_groups(course_id);
        DROP TRIGGER course_student_tariff;
        CREATE TRIGGER course_student_tariff AFTER UPDATE OF monthly_amount ON courses BEGIN
          UPDATE students SET monthly_amount=NEW.monthly_amount WHERE course_id=NEW.id;
        END;
        CREATE TRIGGER group_course_immutable BEFORE UPDATE OF course_id ON student_groups WHEN NEW.course_id<>OLD.course_id BEGIN
          SELECT RAISE(ABORT, 'Group course cannot be changed');
        END;
        CREATE TRIGGER group_student_name AFTER UPDATE OF name ON student_groups BEGIN
          UPDATE students SET group_name=NEW.name WHERE group_id=NEW.id;
        END;
        CREATE TRIGGER group_student_match_insert BEFORE INSERT ON students BEGIN
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM student_groups g JOIN courses c ON c.id=g.course_id
            WHERE g.id=NEW.group_id AND g.course_id=NEW.course_id AND g.name=NEW.group_name AND c.monthly_amount=NEW.monthly_amount
          ) THEN RAISE(ABORT, 'Student must match the group course and tariff') END;
        END;
        CREATE TRIGGER group_student_match_update BEFORE UPDATE OF group_id, course_id, group_name, monthly_amount ON students BEGIN
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM student_groups g JOIN courses c ON c.id=g.course_id
            WHERE g.id=NEW.group_id AND g.course_id=NEW.course_id AND g.name=NEW.group_name AND c.monthly_amount=NEW.monthly_amount
          ) THEN RAISE(ABORT, 'Student must match the group course and tariff') END;
        END;
        PRAGMA user_version = 5;
      `);
    })();
  if (version < 6) {
    // Rebuild the old UNIQUE(name, amount) constraint without changing any IDs
    // or financial values. Foreign keys are rechecked before committing.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const previousSequence = db
          .prepare("SELECT seq FROM sqlite_sequence WHERE name='courses'")
          .get() as { seq: number } | undefined;
        const triggers = db
          .prepare(
            `SELECT name, sql FROM sqlite_master WHERE type='trigger'
          AND (tbl_name='courses' OR name IN ('group_student_match_insert', 'group_student_match_update'))`,
          )
          .all() as { name: string; sql: string }[];
        for (const trigger of triggers)
          db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
        db.exec(`
          CREATE TABLE courses_next (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
            monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount)='integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
            currency TEXT NOT NULL DEFAULT 'UZS' CHECK(currency IN ('UZS','USD')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE(name, currency, monthly_amount)
          );
          INSERT INTO courses_next(id,name,monthly_amount,created_at) SELECT id,name,monthly_amount,created_at FROM courses;
          DROP TABLE courses;
          ALTER TABLE courses_next RENAME TO courses;
        `);
        if (previousSequence)
          db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='courses'").run(
            previousSequence.seq,
          );
        for (const trigger of triggers) {
          if (trigger.name !== 'course_currency_immutable') db.exec(trigger.sql);
        }
        db.exec(`
          CREATE TRIGGER course_currency_immutable BEFORE UPDATE OF currency ON courses
          WHEN NEW.currency<>OLD.currency AND EXISTS(SELECT 1 FROM students WHERE course_id=OLD.id) BEGIN
            SELECT RAISE(ABORT, 'Currency cannot be changed for an enrolled course');
          END;
          PRAGMA user_version=6;
        `);
        if ((db.pragma('foreign_key_check') as unknown[]).length)
          throw new Error('Нарушены связи при миграции валют');
      })();
    } catch (error) {
      db.close();
      throw error;
    } finally {
      if (db.open) db.pragma('foreign_keys = ON');
    }
  }
  if (version < 7)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS course_tariffs (
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          effective_month TEXT NOT NULL,
          monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount)='integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
          PRIMARY KEY(course_id,effective_month)
        );
        INSERT OR IGNORE INTO course_tariffs(course_id,effective_month,monthly_amount)
          SELECT id,'1900-01',monthly_amount FROM courses;
        CREATE TRIGGER IF NOT EXISTS course_initial_tariff AFTER INSERT ON courses BEGIN
          INSERT INTO course_tariffs(course_id,effective_month,monthly_amount) VALUES(NEW.id,'1900-01',NEW.monthly_amount);
        END;
        CREATE TRIGGER IF NOT EXISTS course_tariff_version AFTER UPDATE OF monthly_amount ON courses
        WHEN NEW.monthly_amount<>OLD.monthly_amount BEGIN
          INSERT INTO course_tariffs(course_id,effective_month,monthly_amount)
          VALUES(NEW.id,strftime('%Y-%m','now','+5 hours','start of month','+1 month'),NEW.monthly_amount)
          ON CONFLICT(course_id,effective_month) DO UPDATE SET monthly_amount=excluded.monthly_amount;
        END;
        PRAGMA user_version=7;
      `);
    })();
  if (version < 8)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bot_admin_enrollment (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
          armed_by INTEGER NOT NULL,
          armed_at INTEGER NOT NULL,
          claimed_by INTEGER,
          claimed_at INTEGER
        );
        PRAGMA user_version=8;
      `);
    })();
  if (version < 9)
    db.transaction(() => {
      if (
        !(db.pragma('table_info(student_groups)') as { name: string }[]).some(
          (column) => column.name === 'starts_on',
        )
      )
        db.exec('ALTER TABLE student_groups ADD COLUMN starts_on TEXT');
      if (
        !(db.pragma('table_info(students)') as { name: string }[]).some(
          (column) => column.name === 'enrolled_on',
        )
      )
        db.exec('ALTER TABLE students ADD COLUMN enrolled_on TEXT');
      db.exec(`
      CREATE TABLE IF NOT EXISTS payment_allocations (
        payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        billing_month TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
        PRIMARY KEY(payment_id,billing_month)
      );
      CREATE INDEX IF NOT EXISTS allocations_period ON payment_allocations(billing_month,payment_id);
      INSERT INTO payment_allocations(payment_id,billing_month,amount) SELECT id,substr(paid_at,1,7),amount FROM payments WHERE NOT EXISTS(SELECT 1 FROM payment_allocations a WHERE a.payment_id=payments.id);
      CREATE TRIGGER IF NOT EXISTS payment_default_allocation AFTER INSERT ON payments BEGIN
        INSERT INTO payment_allocations(payment_id,billing_month,amount) VALUES(NEW.id,substr(NEW.paid_at,1,7),NEW.amount);
      END;
      PRAGMA user_version=9;
    `);
    })();
  if (version < 10)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('teacher','admin','owner')),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
        session_version INTEGER NOT NULL DEFAULT 1, bootstrap_managed INTEGER NOT NULL DEFAULT 0,
        telegram_id INTEGER UNIQUE, created_by INTEGER REFERENCES staff_users(id),
        created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON staff_users(role) WHERE role='owner';
      CREATE TABLE IF NOT EXISTS staff_groups (
        user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
        PRIMARY KEY(user_id,group_id)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
        action TEXT NOT NULL, target_type TEXT NOT NULL, target_id INTEGER,
        details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS audit_created ON audit_events(id DESC);

      PRAGMA user_version=10;
    `);
      if (
        !(db.pragma('table_info(web_sessions)') as { name: string }[]).some(
          (column) => column.name === 'user_id',
        )
      )
        db.exec(
          'ALTER TABLE web_sessions ADD COLUMN user_id INTEGER REFERENCES staff_users(id) ON DELETE CASCADE',
        );
      db.exec(
        "DELETE FROM web_sessions WHERE user_id IS NULL; DELETE FROM login_attempts WHERE key LIKE 'account:%';",
      );
    })();
  return db;
}
