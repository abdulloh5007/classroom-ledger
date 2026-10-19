-- Schema of the previous release, used to verify real v5 migrations.
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
CREATE TABLE login_attempts (
          key TEXT PRIMARY KEY,
          count INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
CREATE TABLE courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
          monthly_amount INTEGER NOT NULL CHECK(typeof(monthly_amount)='integer' AND monthly_amount BETWEEN 1 AND 1000000000000),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(name, monthly_amount)
        );
CREATE TABLE student_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
          course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(name, course_id)
        );
CREATE INDEX payments_student_date ON payments(student_id, paid_at);
CREATE INDEX web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
CREATE INDEX students_course ON students(course_id);
CREATE INDEX students_group ON students(group_id);
CREATE INDEX groups_course ON student_groups(course_id);
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
PRAGMA user_version=5;
