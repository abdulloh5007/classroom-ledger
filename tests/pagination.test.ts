import { afterEach, beforeEach, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { createApp } from '../src/app.js';
import type { PaymentPage, Student } from '../src/contracts.js';

let db: Database.Database;
let service: LedgerService;
let app: ReturnType<typeof createApp>;
let student: Student;
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db);
  app = createApp(service);
  student = service.createStudent({
    name: 'Test',
    phone: '+998901234567',
    group: 'Test',
    monthlyAmount: 10000,
  });
});
afterEach(async () => {
  await app.close();
  db.close();
});

it('листит 25 платежей порциями 10/10/5 со стабильным порядком и полными итогами', async () => {
  for (let i = 0; i < 25; i++)
    service.addPayment(student.id, { amount: 100, date: i % 2 ? '2026-10-01' : '2026-10-02' });
  const ids: number[] = [];
  let cursor: string | null = null;
  for (const count of [10, 10, 5]) {
    const response = await app.inject(
      `/students/${student.id}/payments?limit=10${cursor ? `&cursor=${cursor}` : ''}`,
    );
    expect(response.statusCode).toBe(200);
    const page: PaymentPage = response.json();
    expect(page.items).toHaveLength(count);
    expect(page.total).toBe(25);
    expect(page.totalAmount).toBe(2500);
    ids.push(...page.items.map((payment) => payment.id));
    cursor = page.nextCursor;
  }
  expect(cursor).toBeNull();
  expect(new Set(ids).size).toBe(25);
  expect(ids).toEqual(service.payments(student.id).map((payment) => payment.id));
});

it('не сдвигает страницы при добавлении новой оплаты в начало', () => {
  for (let i = 0; i < 12; i++) service.addPayment(student.id, { amount: 100, date: '2026-10-01' });
  const first = service.paymentPage(student.id, { limit: 10 });
  service.addPayment(student.id, { amount: 100, date: '2026-11-01' });
  const second = service.paymentPage(student.id, { limit: 10, cursor: first.nextCursor });
  expect(second.items).toHaveLength(2);
  expect(second.items.some((payment) => first.items.some((old) => old.id === payment.id))).toBe(
    false,
  );
  expect(second.total).toBe(13);
});

it('отклоняет некорректные размеры и курсоры, сохраняет массив для старых запросов', async () => {
  for (const query of [
    'limit=0',
    'limit=51',
    'limit=1.5',
    'limit=abc',
    'cursor=abc',
    'limit=10&cursor=abc',
    `limit=10&cursor=${Buffer.from(JSON.stringify({ date: "' OR 1=1", id: 1 })).toString('base64url')}`,
  ])
    expect((await app.inject(`/students/${student.id}/payments?${query}`)).statusCode).toBe(400);
  expect((await app.inject(`/students/${student.id}/payments`)).json()).toEqual([]);
  expect((await app.inject(`/students/${student.id}/payments?limit=10`)).json()).toEqual({
    items: [],
    total: 0,
    totalAmount: 0,
    nextCursor: null,
  });
  expect((await app.inject('/students/999/payments?limit=10')).statusCode).toBe(404);
});
