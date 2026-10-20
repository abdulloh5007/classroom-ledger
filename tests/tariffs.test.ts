import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { currentMonth, shiftMonth } from '../src/calendar.js';
import { createApp } from '../src/app.js';
let db: Database.Database;
let service: LedgerService;
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db);
});
afterEach(() => db.close());
function fixture() {
  const course = service.createCourse({ name: 'English', monthlyAmount: 1000000 });
  const group = service.createGroup({ name: 'Morning', courseId: course.id });
  const student = service.createStudent({
    name: 'Test',
    phone: '+998901234567',
    groupId: group.id,
  });
  return { course, group, student };
}
it('изменение цены сохраняет прошлые и текущий месяцы, новый тариф начинается в следующем', () => {
  const { course, group, student } = fixture();
  const month = currentMonth();
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  service.addPayment(student.id, { amount: 250000, date: previous + '-01' });
  const payments = service.payments(student.id);
  const old = service.monthlyBalances(previous, group.id);
  service.updateCourse(course.id, { monthlyAmount: 1200000 });
  expect(service.monthlyBalances(previous, group.id)).toEqual(old);
  expect(service.balance(student.id, previous)).toEqual({ paid: 250000, debt: 750000 });
  expect(service.monthlyBalances(month, group.id)).toMatchObject([
    { monthlyAmount: 1000000, debt: 1000000 },
  ]);
  expect(service.monthlyBalances(next, group.id)).toMatchObject([
    { monthlyAmount: 1200000, debt: 1200000 },
  ]);
  expect(service.payments(student.id)).toEqual(payments);
  expect(service.balance(student.id, next).debt).toBe(1200000);
});
it('повторные изменения обновляют только предстоящий тариф, сохраняя старую цену и правила переплаты', () => {
  const { course, student } = fixture();
  const month = currentMonth();
  const next = shiftMonth(month, 1);
  service.updateCourse(course.id, { monthlyAmount: 1200000 });
  service.updateCourse(course.id, { monthlyAmount: 900000 });
  expect(service.balance(student.id, month).debt).toBe(1000000);
  expect(service.balance(student.id, next).debt).toBe(900000);
  expect(
    db.prepare('SELECT COUNT(*) AS n FROM course_tariffs WHERE course_id=?').get(course.id),
  ).toEqual({ n: 2 });
  expect(() => service.addPayment(student.id, { amount: 1000001, date: month + '-01' })).toThrow(
    'превышает',
  );
  service.addPayment(student.id, { amount: 1000000, date: month + '-01' });
  expect(service.balance(student.id, month).debt).toBe(0);
});
it('переименовывает группу, правит курс атомарно и не меняет исторический долг', () => {
  const { group, student } = fixture();
  const month = currentMonth();
  const updated = service.updateGroup(group.id, {
    name: 'Evening',
    courseName: 'Advanced English',
    monthlyAmount: 1100000,
  });
  expect(updated).toMatchObject({
    name: 'Evening',
    courseName: 'Advanced English',
    monthlyAmount: 1100000,
  });
  expect(service.student(student.id).group).toBe('Evening');
  expect(service.balance(student.id, month).debt).toBe(1000000);
  expect(() => service.updateGroup(group.id, { name: 'Bad', courseId: 999 })).toThrow();
  expect(service.group(group.id).name).toBe('Evening');
});
it('удаление группы удаляет только её учеников, оплаты и квитанции, сохраняя общий курс и другие группы', () => {
  const { course, group, student } = fixture();
  const other = service.createGroup({ name: 'Other', courseId: course.id });
  const pupil = service.createStudent({ name: 'Other', phone: '+998901234567', groupId: other.id });
  service.addPayment(student.id, { amount: 100, date: currentMonth() + '-01' }, 'delete-group');
  service.addPayment(pupil.id, { amount: 200, date: currentMonth() + '-01' });
  service.deleteGroup(group.id);
  expect(() => service.group(group.id)).toThrow('Группа не найдена');
  expect(() => service.student(student.id)).toThrow('Ученик не найден');
  expect(db.prepare('SELECT * FROM bot_receipts').all()).toEqual([]);
  expect(service.payments(pupil.id)).toHaveLength(1);
  expect(service.course(course.id).studentCount).toBe(1);
  expect(db.pragma('foreign_key_check')).toEqual([]);
  service.deleteGroup(other.id);
  expect(service.courses()).toEqual([]);
  expect(db.prepare('SELECT * FROM course_tariffs').all()).toEqual([]);
});
it('API групп валидирует изменения и возвращает 204 при удалении', async () => {
  const { group } = fixture();
  const app = createApp(service);
  try {
    expect(
      (await app.inject({ method: 'PATCH', url: `/groups/${group.id}`, payload: { name: 'New' } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'PATCH', url: `/groups/${group.id}`, payload: {} })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/groups/${group.id}`,
          payload: { courseId: 999 },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/groups/${group.id}` })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ method: 'DELETE', url: `/groups/${group.id}` })).statusCode).toBe(
      404,
    );
  } finally {
    await app.close();
  }
});

it('миграция v6 сохраняет записи, а версии тарифов переживают повторный запуск', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-tariffs-'));
  const path = join(directory, 'db.sqlite');
  let file: Database.Database | undefined;
  try {
    file = openDatabase(path);
    let ledger = new LedgerService(file);
    const course = ledger.createCourse({ name: 'English', monthlyAmount: 1000000 });
    const student = ledger.createStudent({
      name: 'Test',
      phone: '+998901234567',
      courseId: course.id,
    });
    ledger.addPayment(student.id, { amount: 250000, date: currentMonth() + '-01' });
    const students = file.prepare('SELECT * FROM students').all();
    const payments = file.prepare('SELECT * FROM payments').all();
    file.exec(
      'DROP TRIGGER course_initial_tariff; DROP TRIGGER course_tariff_version; DROP TABLE course_tariffs; PRAGMA user_version=6;',
    );
    file.close();
    file = openDatabase(path);
    ledger = new LedgerService(file);
    expect(file.prepare('SELECT * FROM students').all()).toEqual(students);
    expect(file.prepare('SELECT * FROM payments').all()).toEqual(payments);
    expect(ledger.balance(student.id, currentMonth())).toEqual({ paid: 250000, debt: 750000 });
    ledger.updateCourse(course.id, { monthlyAmount: 1200000 });
    file.close();
    file = openDatabase(path);
    ledger = new LedgerService(file);
    expect(ledger.balance(student.id, currentMonth())).toEqual({ paid: 250000, debt: 750000 });
    expect(ledger.balance(student.id, shiftMonth(currentMonth(), 1))).toEqual({
      paid: 0,
      debt: 1200000,
    });
    expect(file.pragma('foreign_key_check')).toEqual([]);
  } finally {
    if (file?.open) file.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('тариф курса доступен без учеников и сохраняет текущую цену после правки', () => {
  const course = service.createCourse({ name: 'Empty course', monthlyAmount: 100000 });
  service.updateCourse(course.id, { monthlyAmount: 200000 });
  expect(service.courseTariff(course.id, currentMonth())).toBe(100000);
  expect(service.courseTariff(course.id, shiftMonth(currentMonth(), 1))).toBe(200000);
  expect(() => service.courseTariff(course.id, '2026-99')).toThrow();
  expect(() => service.courseTariff(99999)).toThrow('Курс не найден');
});
