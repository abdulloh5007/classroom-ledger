import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
it('v8→v10 сохраняет реальные старые значения, создаёт распределение и оставляет даты неподтверждёнными', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-v8-upgrade-'));
  const path = join(directory, 'preview.db');
  let db: Database.Database | undefined;
  try {
    db = new Database(path);
    db.pragma('foreign_keys=ON');
    db.exec(readFileSync(new URL('./fixtures/schema-v8.sql', import.meta.url), 'utf8'));
    db.exec(
      "INSERT INTO courses(id,name,monthly_amount,currency) VALUES(7,'Legacy USD',12550,'USD'); INSERT INTO student_groups(id,name,course_id) VALUES(11,'Legacy group',7); INSERT INTO students(id,name,phone,group_name,monthly_amount,course_id,group_id) VALUES(13,'Fixture pupil','+998901234567','Legacy group',12550,7,11); INSERT INTO payments(id,student_id,amount,paid_at) VALUES(17,13,2550,'2025-09-03'); INSERT INTO admins(telegram_id,added_by) VALUES(456,123);",
    );
    const original = db.prepare('SELECT * FROM payments').all();
    db.close();
    db = openDatabase(path);
    const ledger = new LedgerService(db, 123);
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    expect(db.prepare('SELECT * FROM payments').all()).toEqual(original);
    expect(ledger.student(13)).toMatchObject({ id: 13, enrolledOn: null, currency: 'USD' });
    expect(ledger.group(11).startsOn).toBeNull();
    expect(ledger.payments(13)[0]?.allocations).toEqual([{ month: '2025-09', amount: 2550 }]);
    expect(ledger.balance(13, '2025-09')).toEqual({ paid: 2550, debt: 10000 });
    expect(ledger.admins()[0]?.telegramId).toBe(456);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
    db = openDatabase(path);
    expect(new LedgerService(db).balance(13, '2025-09')).toEqual({ paid: 2550, debt: 10000 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM payment_allocations').get()).toEqual({
      count: 1,
    });
  } finally {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
