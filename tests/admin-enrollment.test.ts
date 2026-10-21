import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
let db: Database.Database;
let service: LedgerService;
const owner = 123;
const now = () => Math.floor(Date.now() / 1000);
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db, owner);
});
afterEach(() => {
  if (db.open) db.close();
});
it('по умолчанию автовыдача выключена; владелец включает и отменяет её', () => {
  expect(service.nextAdminEnrollment(owner).enabled).toBe(false);
  expect(service.claimNextAdmin(456, now())).toBe(false);
  service.armNextAdmin(owner);
  expect(service.nextAdminEnrollment(owner).enabled).toBe(true);
  service.cancelNextAdmin(owner);
  expect(service.claimNextAdmin(456, now())).toBe(false);
  expect(service.canAccess(456)).toBe(false);
});
it('выдаёт права ровно одному новому пользователю с added_by владельца', () => {
  service.armNextAdmin(owner);
  expect(service.claimNextAdmin(456, now())).toBe(true);
  expect(service.claimNextAdmin(789, now())).toBe(false);
  expect(service.claimNextAdmin(456, now())).toBe(false);
  expect(service.admins()).toEqual([expect.objectContaining({ telegramId: 456, addedBy: owner })]);
  expect(service.nextAdminEnrollment(owner)).toMatchObject({ enabled: false, claimedBy: 456 });
});
it('владелец, действующий админ и старое сообщение не расходуют приглашение', () => {
  service.addAdmin(owner, 456);
  service.armNextAdmin(owner);
  const armed = service.nextAdminEnrollment(owner).armedAt!;
  expect(service.claimNextAdmin(owner, now())).toBe(false);
  expect(service.claimNextAdmin(456, now())).toBe(false);
  expect(service.claimNextAdmin(789, armed - 1)).toBe(false);
  expect(service.nextAdminEnrollment(owner).enabled).toBe(true);
  expect(service.claimNextAdmin(789, now())).toBe(true);
});
it('обычный админ не может включить, отменить или просмотреть режим', () => {
  service.addAdmin(owner, 456);
  expect(() => service.armNextAdmin(456)).toThrow('Только для владельца');
  expect(() => service.cancelNextAdmin(456)).toThrow('Только для владельца');
  expect(() => service.nextAdminEnrollment(456)).toThrow('Только для владельца');
});
it('состояние и погашение переживают перезапуск; повторное включение — явное действие владельца', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-enrollment-'));
  try {
    const path = join(directory, 'app.db');
    let stored = openDatabase(path);
    let ledger = new LedgerService(stored, owner);
    ledger.armNextAdmin(owner);
    stored.close();
    stored = openDatabase(path);
    ledger = new LedgerService(stored, owner);
    expect(ledger.nextAdminEnrollment(owner).enabled).toBe(true);
    expect(ledger.claimNextAdmin(456, now())).toBe(true);
    stored.close();
    stored = openDatabase(path);
    ledger = new LedgerService(stored, owner);
    expect(ledger.claimNextAdmin(789, now())).toBe(false);
    expect(ledger.canAccess(456)).toBe(true);
    ledger.armNextAdmin(owner);
    expect(ledger.claimNextAdmin(789, now())).toBe(true);
    stored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it('смена владельца не переносит его непогашенное разрешение', () => {
  service.armNextAdmin(owner);
  const replacement = new LedgerService(db, 999);
  expect(replacement.claimNextAdmin(456, now())).toBe(false);
  replacement.armNextAdmin(999);
  expect(replacement.claimNextAdmin(456, now())).toBe(true);
  expect(replacement.admins()[0]?.addedBy).toBe(999);
});

it('миграция v7→v8 сохраняет учеников, платежи и админов и не включает автодоступ', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-enrollment-migration-'));
  let stored: Database.Database | undefined;
  try {
    const path = join(directory, 'app.db');
    stored = openDatabase(path);
    const previous = new LedgerService(stored, owner);
    const student = previous.createStudent({
      name: 'Demo',
      phone: '+998901234567',
      group: 'A2',
      monthlyAmount: 100000,
    });
    previous.addPayment(student.id, { amount: 10000, date: '2026-10-20' });
    previous.addAdmin(owner, 456);
    const students = previous.students(),
      payments = previous.payments(student.id),
      admins = previous.admins();
    stored.exec('DROP TABLE bot_admin_enrollment; PRAGMA user_version=7');
    stored.close();
    stored = openDatabase(path);
    const migrated = new LedgerService(stored, owner);
    expect(stored.pragma('user_version', { simple: true })).toBe(10);
    expect(migrated.students()).toEqual(students);
    expect(migrated.payments(student.id)).toEqual(payments);
    expect(migrated.admins()).toEqual(admins);
    expect(migrated.nextAdminEnrollment(owner).enabled).toBe(false);
    expect(stored.pragma('foreign_key_check')).toEqual([]);
  } finally {
    if (stored?.open) stored.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
