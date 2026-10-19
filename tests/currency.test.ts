import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { LedgerService, parseAmount } from '../src/services/ledger.js';
import { formatCurrency, moneyInput, parseMoneyInput } from '../src/money.js';
import { createApp } from '../src/app.js';
let db: Database.Database;
let service: LedgerService;
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db);
});
afterEach(() => db.close());
it('хранит доллары в центах без ошибок дробных вычислений', () => {
  expect(parseMoneyInput('1 250,50', 'USD')).toBe(125050);
  expect(parseMoneyInput('0.29', 'USD')).toBe(29);
  expect(parseAmount('0,01', 'USD')).toBe(1);
  expect(moneyInput(125050, 'USD')).toBe('1250.50');
  expect(formatCurrency(125050, 'USD')).toBe('1 250,50 $');
  expect(formatCurrency(125050)).toBe('125 050 сум');
  for (const input of ['1.234', '-1', '1e3', 'NaN', '1,2.3', '10000000001.00'])
    expect(parseMoneyInput(input, 'USD')).toBeUndefined();
  expect(parseMoneyInput('1,50', 'UZS')).toBeUndefined();
  expect(() => parseAmount('0', 'USD')).toThrow();
});
it('различает одинаковые имена и числовые тарифы в разных валютах', () => {
  const uzs = service.createCourse({ name: 'English', monthlyAmount: 100, currency: 'UZS' });
  const usd = service.createCourse({ name: 'English', monthlyAmount: 100, currency: 'USD' });
  expect(uzs.id).not.toBe(usd.id);
  expect(() =>
    service.createCourse({ name: 'English', monthlyAmount: 100, currency: 'USD' }),
  ).toThrow('Такой курс уже существует');
});
it('считает долларовые оплаты, MAX и долг в тех же целых центах', () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 12550, currency: 'USD' });
  const group = service.createGroup({ name: 'Evening', courseId: course.id });
  const student = service.createStudent({
    name: 'Test',
    phone: '+998901234567',
    groupId: group.id,
  });
  service.addPayment(student.id, { amount: parseAmount('25,25', 'USD'), date: '2026-10-01' });
  expect(service.balance(student.id, '2026-10')).toEqual({ paid: 2525, debt: 10025 });
  expect(service.debtors('2026-10', group.id)).toMatchObject([{ currency: 'USD', debt: 10025 }]);
  expect(student.currency).toBe('USD');
  expect(group.currency).toBe('USD');
  expect(() => service.addPayment(student.id, { amount: 10026, date: '2026-10-01' })).toThrow(
    'превышает',
  );
  service.addPayment(student.id, { amount: 10025, date: '2026-10-01' });
  expect(service.debtors('2026-10', group.id)).toEqual([]);
});
it('запрещает переопределять валюту существующих оплат изменением курса или переводом ученика', () => {
  const usd = service.createCourse({ name: 'USD', monthlyAmount: 10000, currency: 'USD' });
  const uzs = service.createCourse({ name: 'UZS', monthlyAmount: 10000 });
  const student = service.createStudent({ name: 'Test', phone: '+998901234567', courseId: usd.id });
  expect(service.updateCourse(usd.id, { monthlyAmount: 11000 }).currency).toBe('USD');
  expect(() => service.updateCourse(usd.id, { currency: 'UZS' })).toThrow('Нельзя менять валюту');
  expect(() => db.prepare('UPDATE courses SET currency=? WHERE id=?').run('UZS', usd.id)).toThrow();
  service.addPayment(student.id, { amount: 100, date: '2026-10-01' });
  expect(() => service.updateStudent(student.id, { courseId: uzs.id })).toThrow(
    'Нельзя переводить',
  );
  expect(service.student(student.id).currency).toBe('USD');
  expect(service.payments(student.id)[0]?.amount).toBe(100);
});
it('валидирует валюты и целые минимальные единицы в API', async () => {
  const app = createApp(service);
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/courses',
          payload: { name: 'Bad', monthlyAmount: 50, currency: 'INVALID' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/courses',
          payload: { name: 'Bad', monthlyAmount: 50.25, currency: 'USD' },
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      method: 'POST',
      url: '/courses',
      payload: { name: 'English', monthlyAmount: 5025, currency: 'USD' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ monthlyAmount: 5025, currency: 'USD' });
  } finally {
    await app.close();
  }
});
it('мигрирует v5 без потери ID, сумм, групп и связей, повторный старт ничего не меняет', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-currency-'));
  const path = join(directory, 'db.sqlite');
  let file: Database.Database | undefined;
  try {
    file = new Database(path);
    file.exec(readFileSync(new URL('./fixtures/schema-v5.sql', import.meta.url), 'utf8'));
    file.pragma('foreign_keys = ON');
    file.exec(`INSERT INTO courses(id,name,monthly_amount) VALUES(7,'English',1200000);
      INSERT INTO student_groups(id,name,course_id) VALUES(11,'A1',7);
      INSERT INTO students(id,name,phone,group_name,monthly_amount,course_id,group_id) VALUES(13,'Old','+998901234567','A1',1200000,7,11);
      INSERT INTO payments(student_id,amount,paid_at) VALUES(13,250000,'2026-10-01');`);
    file.exec(
      "INSERT INTO courses(id,name,monthly_amount) VALUES(99,'Deleted course',1000); DELETE FROM courses WHERE id=99;",
    );
    const student = { id: 13 };
    const students = file.prepare('SELECT * FROM students').all();
    const payments = file.prepare('SELECT * FROM payments').all();
    const groups = file.prepare('SELECT * FROM student_groups').all();
    file.close();
    file = openDatabase(path);
    expect(file.prepare('SELECT * FROM students').all()).toEqual(students);
    expect(file.prepare('SELECT * FROM payments').all()).toEqual(payments);
    expect(file.prepare('SELECT * FROM student_groups').all()).toEqual(groups);
    expect(file.pragma('foreign_key_check')).toEqual([]);
    expect(file.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(new LedgerService(file).student(student.id).currency).toBe('UZS');
    expect(new LedgerService(file).createCourse({ name: 'New', monthlyAmount: 100 }).id).toBe(100);
    file.close();
    file = openDatabase(path);
    expect(new LedgerService(file).balance(student.id, '2026-10')).toEqual({
      paid: 250000,
      debt: 950000,
    });
  } finally {
    if (file?.open) file.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
