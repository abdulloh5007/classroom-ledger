import { today, currentMonth, shiftMonth } from '../src/calendar.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
let db: Database.Database, ledger: LedgerService;
beforeEach(() => {
  db = openDatabase(':memory:');
  ledger = new LedgerService(db);
});
afterEach(() => db.close());
function enrollment() {
  const course = ledger.createCourse({ name: 'English', monthlyAmount: 1000000 });
  const group = ledger.createGroup({ name: 'New', courseId: course.id, startsOn: '2026-10-15' });
  const student = ledger.createStudent({
    name: 'Aziza',
    phone: '+998901234567',
    groupId: group.id,
    enrolledOn: '2026-11-02',
  });
  return { course, group, student };
}
it('начисляет только с более поздней даты старта и зачисления, полный первый месяц', () => {
  const { student } = enrollment();
  expect(ledger.debtors('2026-10')).toEqual([]);
  expect(ledger.balance(student.id, '2026-10')).toEqual({ paid: 0, debt: 0 });
  expect(ledger.debtors('2026-11')[0]).toMatchObject({ studentId: student.id, debt: 1000000 });
});
it('отделяет фактическое поступление от будущего учебного периода', () => {
  const { student } = enrollment();
  const payment = ledger.addPayment(student.id, {
    amount: 250000,
    date: '2026-09-01',
    billingMonth: '2026-11',
  });
  expect(payment.date).toBe('2026-09-01');
  expect(payment.allocations).toEqual([{ month: '2026-11', amount: 250000 }]);
  expect(ledger.balance(student.id, '2026-11')).toEqual({ paid: 250000, debt: 750000 });
  expect(ledger.balance(student.id, '2026-09')).toEqual({ paid: 0, debt: 0 });
});
it('не принимает оплату за период до начала обучения', () => {
  const { student } = enrollment();
  expect(() =>
    ledger.addPayment(student.id, { amount: 100, date: '2026-12-01', billingMonth: '2026-10' }),
  ).toThrow('раньше начала');
  expect(ledger.payments(student.id)).toEqual([]);
});
it('не принимает зачисление раньше фактического начала группы', () => {
  const { group } = enrollment();
  expect(() =>
    ledger.createStudent({
      name: 'Test',
      phone: '+998901234567',
      groupId: group.id,
      enrolledOn: '2026-10-14',
    }),
  ).toThrow('раньше начала');
});
it('распределяет несколько месяцев, сохраняет дату и квитанцию без повторной записи', () => {
  const { student } = enrollment();
  const input = {
    amount: 1200000,
    date: '2026-10-05',
    allocations: [
      { month: '2026-11', amount: 1000000 },
      { month: '2026-12', amount: 200000 },
    ],
  };
  const first = ledger.addPayment(student.id, input, 'fixture-v2-payment');
  expect(ledger.addPayment(student.id, input, 'fixture-v2-payment')).toEqual(first);
  expect(ledger.balance(student.id, '2026-11').debt).toBe(0);
  expect(ledger.balance(student.id, '2026-12').debt).toBe(800000);
  expect(ledger.paymentPage(student.id, { limit: 10 }).items[0]?.allocations).toHaveLength(2);
  expect(ledger.payments(student.id)).toHaveLength(1);
});
it('откатывает целиком распределение, если хотя бы один месяц превышает остаток', () => {
  const { student } = enrollment();
  expect(() =>
    ledger.addPayment(student.id, {
      amount: 1100000,
      date: '2026-10-01',
      allocations: [
        { month: '2026-11', amount: 100000 },
        { month: '2026-12', amount: 1000000 },
      ],
    }),
  ).not.toThrow();
  const before = ledger.payments(student.id).length;
  expect(() =>
    ledger.addPayment(student.id, {
      amount: 1000000,
      date: '2026-10-02',
      allocations: [
        { month: '2026-11', amount: 900000 },
        { month: '2026-12', amount: 100000 },
      ],
    }),
  ).toThrow('остаток');
  expect(ledger.payments(student.id)).toHaveLength(before);
  expect(ledger.balance(student.id, '2026-11').paid).toBe(100000);
});
it('отклоняет несовпадающие суммы, повтор месяца и два способа распределения', () => {
  const { student } = enrollment();
  for (const input of [
    { amount: 100, date: '2026-10-01', allocations: [{ month: '2026-11', amount: 99 }] },
    {
      amount: 100,
      date: '2026-10-01',
      allocations: [
        { month: '2026-11', amount: 50 },
        { month: '2026-11', amount: 50 },
      ],
    },
    {
      amount: 100,
      date: '2026-10-01',
      billingMonth: '2026-11',
      allocations: [{ month: '2026-11', amount: 100 }],
    },
  ])
    expect(() => ledger.addPayment(student.id, input)).toThrow();
  expect(ledger.payments(student.id)).toEqual([]);
});
it('не разрешает датами сделать существующие оплаты недействительными', () => {
  const { student, group } = enrollment();
  ledger.addPayment(student.id, { amount: 100, date: '2026-10-01', billingMonth: '2026-11' });
  expect(() => ledger.updateStudent(student.id, { enrolledOn: '2026-12-01' })).toThrow(
    'противоречит оплатам',
  );
  expect(() => ledger.updateGroup(group.id, { startsOn: '2026-12-01' })).toThrow('противоречит');
  expect(ledger.group(group.id).startsOn).toBe('2026-10-15');
});
it('удаляет распределение вместе с учеником', () => {
  const { student } = enrollment();
  ledger.addPayment(student.id, { amount: 100, date: '2026-10-01', billingMonth: '2026-11' });
  ledger.deleteStudent(student.id);
  expect(db.prepare('SELECT COUNT(*) AS count FROM payment_allocations').get()).toEqual({
    count: 0,
  });
  expect(db.pragma('foreign_key_check')).toEqual([]);
});

it('обычное редактирование старых записей не подставляет сегодняшнюю дату', () => {
  const student = ledger.createStudent({
    name: 'Legacy',
    phone: '+998901234567',
    group: 'Legacy group',
    monthlyAmount: 1000,
  });
  ledger.updateGroup(student.groupId, { name: 'Renamed' });
  ledger.updateStudent(student.id, { name: 'Renamed pupil' });
  expect(ledger.group(student.groupId).startsOn).toBeNull();
  expect(ledger.student(student.id).enrolledOn).toBeNull();
  expect(ledger.balance(student.id, '2025-01').debt).toBe(1000);
});

it('новому ученику старой группы назначает сегодняшнее зачисление, а не старый долг', () => {
  const old = ledger.createStudent({
    name: 'Legacy',
    phone: '+998901234567',
    group: 'Legacy',
    monthlyAmount: 1000,
  });
  const added = ledger.createStudent({ name: 'New', phone: '+998901234568', groupId: old.groupId });
  expect(added.enrolledOn).toBe(today());
  expect(ledger.balance(added.id, shiftMonth(currentMonth(), -1)).debt).toBe(0);
  expect(ledger.balance(old.id, shiftMonth(currentMonth(), -1)).debt).toBe(1000);
});
