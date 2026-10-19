import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService, parseAmount } from '../src/services/ledger.js';
import { dateSchema, monthSchema } from '../src/contracts.js';
import { monthRange, shiftMonth, today } from '../src/calendar.js';

let db: Database.Database;
let service: LedgerService;
const input = {
  name: 'Азиза',
  phone: '+998901234567',
  group: 'English A2',
  monthlyAmount: 1000000,
};
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db, 123);
});
afterEach(() => db.close());
describe('Расчёт задолженности', () => {
  it('учитывает полную месячную сумму без оплат', () => {
    const student = service.createStudent(input);
    expect(service.debtors('2026-10')).toEqual([
      {
        studentId: student.id,
        name: input.name,
        phone: input.phone,
        group: input.group,
        monthlyAmount: 1000000,
        paid: 0,
        debt: 1000000,
      },
    ]);
  });
  it('суммирует несколько оплат только в указанном месяце', () => {
    const student = service.createStudent(input);
    service.addPayment(student.id, { amount: 200000, date: '2026-10-01' });
    service.addPayment(student.id, { amount: 300000, date: '2026-10-31' });
    service.addPayment(student.id, { amount: 800000, date: '2026-09-30' });
    service.addPayment(student.id, { amount: 900000, date: '2026-11-01' });
    expect(service.debtors('2026-10')[0]).toMatchObject({ paid: 500000, debt: 500000 });
  });
  it('исключает полную оплату и ранее сохранённую переплату', () => {
    const a = service.createStudent(input);
    const b = service.createStudent({ ...input, name: 'Бобур' });
    service.addPayment(a.id, { amount: 1000000, date: '2026-10-10' });
    // Historical overpayments remain readable; new ones are rejected.
    db.prepare('INSERT INTO payments(student_id, amount, paid_at) VALUES (?, ?, ?)').run(
      b.id,
      1200000,
      '2026-10-11',
    );
    expect(service.debtors('2026-10')).toEqual([]);
    expect(service.balance(b.id, '2026-10').debt).toBe(0);
    expect(service.debtors('2026-11')).toHaveLength(2);
  });
  it('относит оплату к paid_at, а не created_at', () => {
    const student = service.createStudent(input);
    service.addPayment(student.id, { amount: 400000, date: '2024-02-29' });
    expect(service.debtors('2024-02')[0]?.paid).toBe(400000);
  });
  it('каскадно удаляет платежи вместе с учеником', () => {
    const student = service.createStudent(input);
    service.addPayment(student.id, { amount: 1, date: '2026-10-01' }, 'test-receipt');
    service.deleteStudent(student.id);
    expect(db.prepare('SELECT * FROM payments').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM bot_receipts').all()).toEqual([]);
    expect(service.debtors('2026-10')).toEqual([]);
  });
  it('повторный Telegram update не создаёт вторую оплату', () => {
    const student = service.createStudent(input);
    const a = service.addPayment(student.id, { amount: 500000, date: '2026-10-01' }, 'update:1');
    const b = service.addPayment(student.id, { amount: 500000, date: '2026-10-01' }, 'update:1');
    expect(a.id).toBe(b.id);
    expect(service.payments(student.id)).toHaveLength(1);
  });
  it('редактирует ученика и не допускает дробные деньги', () => {
    const student = service.createStudent(input);
    expect(service.updateStudent(student.id, { monthlyAmount: 500000 }).monthlyAmount).toBe(500000);
    expect(() => service.updateStudent(student.id, {})).toThrow();
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER])
      expect(() => service.addPayment(student.id, { amount, date: '2026-10-01' })).toThrow();
    expect(() => service.payments(999)).toThrow('Ученик не найден');
  });
});
describe('Месяцы и даты', () => {
  it('корректно проходит границы года и високосный февраль', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(dateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(dateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(dateSchema.safeParse('2026-04-31').success).toBe(false);
    expect(monthRange('9999-11').end).toBe('9999-12-01');
  });
  it('отклоняет неверные месяцы', () => {
    for (const month of ['2026-00', '2026-13', '2026-1', '10-2026', '', '9999-12'])
      expect(monthSchema.safeParse(month).success).toBe(false);
  });
  it('использует дату Ташкента на границе UTC-суток', () => {
    expect(today(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11-01');
  });
  it('разбирает суммы с пробелами, но отклоняет дроби и знаки', () => {
    expect(parseAmount('1 250 000')).toBe(1250000);
    for (const amount of ['1.5', '-100', '1e5', 'abc', '0'])
      expect(() => parseAmount(amount)).toThrow();
  });
});
describe('Права администратора', () => {
  it('доступен владельцу и выданному админу; после удаления доступ отозван', () => {
    expect(service.canAccess(123)).toBe(true);
    expect(service.canAccess(456)).toBe(false);
    service.addAdmin(123, 456);
    expect(service.canAccess(456)).toBe(true);
    service.removeAdmin(123, 456);
    expect(service.canAccess(456)).toBe(false);
  });
  it('только владелец может выдавать и отзывать права', () => {
    service.addAdmin(123, 456);
    expect(() => service.addAdmin(456, 789)).toThrow('Только для владельца');
    expect(() => service.removeAdmin(456, 123)).toThrow('Только для владельца');
    expect(() => service.removeAdmin(123, 123)).toThrow('Владельца нельзя удалить');
    expect(service.canAccess(123)).toBe(true);
  });
});

it('принимает только остаток долга, проверяет месяц и сохраняет повторную квитанцию', () => {
  const student = service.createStudent(input);
  service.addPayment(student.id, { amount: 400000, date: '2026-10-01' });
  expect(() => service.addPayment(student.id, { amount: 600001, date: '2026-10-20' })).toThrow(
    'Сумма оплаты превышает остаток долга',
  );
  expect(service.balance(student.id, '2026-10')).toEqual({ paid: 400000, debt: 600000 });
  const receipt = service.addPayment(
    student.id,
    { amount: 600000, date: '2026-10-20' },
    'full-balance',
  );
  expect(
    service.addPayment(student.id, { amount: 600000, date: '2026-10-20' }, 'full-balance').id,
  ).toBe(receipt.id);
  expect(() => service.addPayment(student.id, { amount: 1, date: '2026-10-31' })).toThrow();
  service.addPayment(student.id, { amount: 1000000, date: '2026-11-01' });
  expect(service.payments(student.id)).toHaveLength(3);
});
