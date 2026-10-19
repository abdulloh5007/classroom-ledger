import { afterEach, beforeEach, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { createApp } from '../src/app.js';
import { currentMonth } from '../src/calendar.js';

let db: Database.Database;
let app: ReturnType<typeof createApp>;
it('закрывает финансовые API сессией, не вызывает Basic Auth и отзывает вход при выходе', async () => {
  const secured = createApp(new LedgerService(db), false, {
    username: 'owner',
    password: 'test-only-password-123456',
  });
  try {
    for (const url of ['/students', '/debtors', '/balances']) {
      const response = await secured.inject(url);
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect((await secured.inject('/auth/session')).json()).toEqual({
      authenticationRequired: true,
      username: null,
    });
    const wrong = await secured.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'owner', password: 'wrong' },
    });
    expect(wrong.statusCode).toBe(401);
    const login = await secured.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'owner', password: 'test-only-password-123456' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('SameSite=Strict');
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const headers = { cookie };
    expect((await secured.inject({ url: '/auth/session', headers })).json()).toEqual({
      authenticationRequired: true,
      username: 'owner',
    });
    expect(
      (await secured.inject({ method: 'POST', url: '/students', payload: input, headers }))
        .statusCode,
    ).toBe(201);
    expect((await secured.inject({ url: '/students', headers })).json()).toHaveLength(1);
    expect(
      (await secured.inject({ method: 'POST', url: '/auth/logout', headers })).statusCode,
    ).toBe(204);
    expect((await secured.inject({ url: '/students', headers })).statusCode).toBe(401);
  } finally {
    await secured.close();
  }
});
it('сессия защищена Secure через HTTPS, истекает и не принимает поддельный cookie', async () => {
  const secured = createApp(new LedgerService(db), false, {
    username: 'owner',
    password: 'test-only-password-123456',
  });
  try {
    const login = await secured.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { username: 'owner', password: 'test-only-password-123456' },
    });
    expect(login.headers['set-cookie']).toContain('; Secure');
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    db.prepare('UPDATE web_sessions SET expires_at=0').run();
    expect((await secured.inject({ url: '/students', headers: { cookie } })).statusCode).toBe(401);
    expect(
      (await secured.inject({ url: '/students', headers: { cookie: 'ledger_session=forged' } }))
        .statusCode,
    ).toBe(401);
  } finally {
    await secured.close();
  }
});
it('ограничивает подбор пароля и блокирует вход с чужого origin', async () => {
  const secured = createApp(new LedgerService(db), false, {
    username: 'owner',
    password: 'test-only-password-123456',
  });
  try {
    const crossOrigin = await secured.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'owner', password: 'test-only-password-123456' },
    });
    expect(crossOrigin.statusCode).toBe(403);
    for (let attempt = 0; attempt < 8; attempt++)
      expect(
        (
          await secured.inject({
            method: 'POST',
            url: '/auth/login',
            payload: { username: 'owner', password: 'wrong' },
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await secured.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { username: 'owner', password: 'test-only-password-123456' },
        })
      ).statusCode,
    ).toBe(429);
  } finally {
    await secured.close();
  }
});
it('сохраняет сессию при перезапуске и отзывает её при смене пароля', async () => {
  const credentials = { username: 'owner', password: 'test-only-password-123456' };
  const first = createApp(new LedgerService(db), false, credentials);
  const login = await first.inject({ method: 'POST', url: '/auth/login', payload: credentials });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await first.close();
  const second = createApp(new LedgerService(db), false, credentials);
  expect((await second.inject({ url: '/students', headers: { cookie } })).statusCode).toBe(200);
  await second.close();
  const changed = createApp(new LedgerService(db), false, {
    ...credentials,
    password: 'new-test-password-123456',
  });
  expect((await changed.inject({ url: '/students', headers: { cookie } })).statusCode).toBe(401);
  await changed.close();
});
const input = {
  name: 'Алишер',
  phone: '+998 90 111 22 33',
  group: 'Frontend',
  monthlyAmount: 600000,
};
beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(new LedgerService(db));
});
afterEach(async () => {
  await app.close();
  db.close();
});
it('CRUD учеников и контракт оплат', async () => {
  const created = await app.inject({ method: 'POST', url: '/students', payload: input });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ id: number }>().id;
  const updated = await app.inject({
    method: 'PATCH',
    url: `/students/${id}`,
    payload: { name: 'Алишер Т.' },
  });
  expect(updated.statusCode).toBe(200);
  const payment = await app.inject({
    method: 'POST',
    url: `/students/${id}/payments`,
    payload: { amount: 200000, date: '2026-10-31' },
  });
  expect(payment.statusCode).toBe(201);
  const debt = await app.inject('/debtors?month=2026-10');
  expect(debt.json()).toMatchObject([{ studentId: id, paid: 200000, debt: 400000 }]);
  expect((await app.inject(`/students/${id}/payments`)).json()).toHaveLength(1);
  expect((await app.inject({ method: 'DELETE', url: `/students/${id}` })).statusCode).toBe(204);
  expect((await app.inject(`/students/${id}/payments`)).statusCode).toBe(404);
});
it('400 на некорректные входы и JSON-ошибки единого формата', async () => {
  for (const url of [
    '/debtors?month=2026-13',
    '/balances?month=2026-13',
    '/balances?month=2026-10&extra=1',
    '/debtors?month=',
    '/debtors?month=2026-10&month=2026-11',
    '/students/no/payments',
    '/students?extra=yes',
  ]) {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
    expect(response.json()).toHaveProperty('details');
  }
  const response = await app.inject({
    method: 'POST',
    url: '/students',
    payload: { ...input, extra: true },
  });
  expect(response.statusCode).toBe(400);
  const badJson = await app.inject({
    method: 'POST',
    url: '/students',
    headers: { 'content-type': 'application/json' },
    payload: '{',
  });
  expect(badJson.statusCode).toBe(400);
  expect(badJson.json()).toHaveProperty('details');
});
it('по умолчанию использует текущий месяц и не включает CORS', async () => {
  await app.inject({ method: 'POST', url: '/students', payload: input });
  const defaultMonth = await app.inject('/debtors');
  const explicitMonth = await app.inject(`/debtors?month=${currentMonth()}`);
  expect(defaultMonth.json()).toEqual(explicitMonth.json());
  expect(defaultMonth.headers['access-control-allow-origin']).toBeUndefined();
});
it('блокирует browser-запись с другого origin', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/students',
    payload: input,
    headers: { origin: 'https://evil.example' },
  });
  expect(response.statusCode).toBe(403);
});
it('неизвестные маршруты и ученики возвращают 404', async () => {
  expect((await app.inject('/missing')).statusCode).toBe(404);
  expect(
    (await app.inject({ method: 'PATCH', url: '/students/999', payload: { name: 'Имя' } }))
      .statusCode,
  ).toBe(404);
});

it('balances возвращает нулевые, частичные, полные и избыточные оплаты без отрицательного долга', async () => {
  const service = new LedgerService(db);
  const amounts = [0, 200000, 600000, 700000];
  const students = amounts.map((_, index) =>
    service.createStudent({ ...input, name: `Ученик ${index}` }),
  );
  amounts.forEach((amount, index) => {
    if (amount) service.addPayment(students[index]!.id, { amount, date: '2026-10-31' });
  });
  service.addPayment(students[0]!.id, { amount: 600000, date: '2026-11-01' });
  const response = await app.inject('/balances?month=2026-10');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject([
    { studentId: students[0]!.id, paid: 0, debt: 600000 },
    { studentId: students[1]!.id, paid: 200000, debt: 400000 },
    { studentId: students[2]!.id, paid: 600000, debt: 0 },
    { studentId: students[3]!.id, paid: 700000, debt: 0 },
  ]);
  expect((await app.inject('/debtors?month=2026-10')).json()).toEqual(
    response.json<unknown[]>().slice(0, 2),
  );
  expect((await app.inject('/balances')).json()).toEqual(
    (await app.inject(`/balances?month=${currentMonth()}`)).json(),
  );
});
