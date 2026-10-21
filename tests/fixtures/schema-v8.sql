CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, phone TEXT NOT NULL, group_name TEXT NOT NULL,
        monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount) = 'integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      , course_id INTEGER REFERENCES courses(id) ON DELETE RESTRICT, group_id INTEGER REFERENCES student_groups(id) ON DELETE RESTRICT);

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

CREATE TABLE web_sessions (
          token_hash TEXT PRIMARY KEY,
          credential_version TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );

CREATE INDEX web_sessions_expiry ON web_sessions(expires_at);

CREATE TABLE login_attempts (
          key TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);

CREATE INDEX students_course ON students(course_id);

CREATE TABLE student_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(name, course_id)
        );

CREATE INDEX students_group ON students(group_id);

CREATE INDEX groups_course ON student_groups(course_id);

CREATE TRIGGER group_course_immutable BEFORE UPDATE OF course_id ON student_groups WHEN NEW.course_id<>OLD.course_id BEGIN
          SELECT RAISE(ABORT, 'Group course cannot be changed');
        END;

CREATE TRIGGER group_student_name AFTER UPDATE OF name ON student_groups BEGIN
          UPDATE students SET group_name=NEW.name WHERE group_id=NEW.id;
        END;

CREATE TABLE "courses" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
            monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount)='integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
            currency TEXT NOT NULL DEFAULT 'UZS' CHECK(currency IN ('UZS','USD')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE(name, currency, monthly_amount)
          );

CREATE TRIGGER course_student_tariff AFTER UPDATE OF monthly_amount ON courses BEGIN
          UPDATE students SET monthly_amount=NEW.monthly_amount WHERE course_id=NEW.id;
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

CREATE TRIGGER course_currency_immutable BEFORE UPDATE OF currency ON courses
          WHEN NEW.currency<>OLD.currency AND EXISTS(SELECT 1 FROM students WHERE course_id=OLD.id) BEGIN
            SELECT RAISE(ABORT, 'Currency cannot be changed for an enrolled course');
          END;

CREATE TABLE course_tariffs (
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          effective_month TEXT NOT NULL,
          monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount)='integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
          PRIMARY KEY(course_id,effective_month)
        );

CREATE TRIGGER course_initial_tariff AFTER INSERT ON courses BEGIN
          INSERT INTO course_tariffs(course_id,effective_month,monthly_amount) VALUES(NEW.id,'1900-01',NEW.monthly_amount);
        END;

CREATE TRIGGER course_tariff_version AFTER UPDATE OF monthly_amount ON courses
        WHEN NEW.monthly_amount<>OLD.monthly_amount BEGIN
          INSERT INTO course_tariffs(course_id,effective_month,monthly_amount)
          VALUES(NEW.id,strftime('%Y-%m','now','+5 hours','start of month','+1 month'),NEW.monthly_amount)
          ON CONFLICT(course_id,effective_month) DO UPDATE SET monthly_amount=excluded.monthly_amount;
        END;

CREATE TABLE bot_admin_enrollment (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
          armed_by INTEGER NOT NULL,
          armed_at INTEGER NOT NULL,
          claimed_by INTEGER,
          claimed_at INTEGER
        );
PRAGMA user_version=8;
