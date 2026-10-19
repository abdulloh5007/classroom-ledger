import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { LedgerService } from '../src/services/ledger.js';
import { AuthService } from '../src/services/auth.js';
import { RequestLimiter } from '../src/security.js';

const credentials = { username: 'owner', password: 'test-only-long-password-1234' };
const studentInput = { name: 'Test', phone: '+998901234567', group: 'Test', monthlyAmount: 1000 };
let db: Database.Database;
let service: LedgerService;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db);
  app = createApp(service, false, credentials);
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
});
async function login() {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials });
  expect(response.statusCode).toBe(200);
  return { cookie: String(response.headers['set-cookie']).split(';')[0]! };
}

it('не отдаёт данные и не выполняет изменения без сессии, включая варианты URL', async () => {
  const student = service.createStudent(studentInput);
  for (const url of [
    '/students',
    '/students/',
    '/%73tudents',
    '//students',
    '/debtors',
    `/students/${student.id}/payments`,
    '/students%2f1/payments',
    '/students/../students',
  ]) {
    const response = await app.inject(url);
    expect([400, 401, 404]).toContain(response.statusCode);
    expect(response.body).not.toContain(studentInput.phone);
  }
  for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
    const response = await app.inject({
      method,
      url: method === 'POST' ? '/students' : `/students/${student.id}`,
      payload: studentInput,
    });
    expect(response.statusCode).toBe(401);
  }
  expect(service.students()).toHaveLength(1);
});

it('не раскрывает локальные файлы через traversal', async () => {
  for (const url of ['/.env', '/.git/config', '/data/app.db', '/%2e%2e/.env', '/src/config.ts'])
    expect((await app.inject(url)).statusCode).toBe(404);
});

it('не принимает SQL/NoSQL injection в логине, ID, month и типах полей', async () => {
  for (const payload of [
    { username: "' OR 1=1 --", password: 'x' },
    { username: { $ne: null }, password: { $ne: null } },
    { ...credentials, extra: true },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload });
    expect([400, 401]).toContain(response.statusCode);
    expect(response.headers['set-cookie']).toBeUndefined();
  }
  const headers = await login();
  for (const url of ['/students/1%20OR%201=1/payments', '/debtors?month=2026-10%27%20OR%201=1--'])
    expect((await app.inject({ url, headers })).statusCode).toBe(400);
  const name = "'); DROP TABLE students; -- <script>alert(1)</script>";
  const response = await app.inject({
    method: 'POST',
    url: '/students',
    headers,
    payload: { ...studentInput, name },
  });
  expect(response.statusCode).toBe(201);
  expect(service.students()[0]?.name).toBe(name);
  expect(db.prepare('SELECT COUNT(*) AS count FROM students').get()).toEqual({ count: 1 });
});

it('отклоняет prototype/constructor poisoning до обработки данных', async () => {
  const headers = { ...(await login()), 'content-type': 'application/json' };
  for (const key of ['__proto__', 'constructor']) {
    const payload = `{"name":"Test","phone":"+998901234567","group":"Test","monthlyAmount":1000,"${key}":{"polluted":true}}`;
    expect(
      (await app.inject({ method: 'POST', url: '/students', headers, payload })).statusCode,
    ).toBe(400);
  }
  expect(Object.prototype).not.toHaveProperty('polluted');
  expect(service.students()).toHaveLength(0);
});

it('отклоняет CSRF по Origin (включая смену схемы) и Fetch Metadata', async () => {
  const headers = await login();
  for (const origin of [
    'https://evil.example',
    'null',
    'https://localhost:80',
    'http://user@localhost:80',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/students',
      payload: studentInput,
      headers: { ...headers, origin, host: 'localhost:80' },
    });
    expect(response.statusCode).toBe(403);
  }
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: studentInput,
        headers: { ...headers, 'sec-fetch-site': 'cross-site' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/students',
        payload: studentInput,
        headers: { ...headers, origin: 'http://localhost:80', host: 'localhost:80' },
      })
    ).statusCode,
  ).toBe(201);
});

it('сохраняет блокировку после пересоздания сервиса, затем разблокирует по времени', () => {
  const auth = new AuthService(db, credentials);
  for (let i = 0; i < 8; i++) expect(() => auth.login('owner', 'bad', 'ip')).toThrow('Неверный');
  const restarted = new AuthService(db, credentials);
  expect(() => restarted.login('owner', credentials.password, 'ip')).toThrow('Слишком много');
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
  expect(restarted.login('owner', credentials.password, 'ip')).toMatch(/^[\w-]{43}$/);
});

it('общий лимит входа блокирует распределённый подбор и смену логинов', async () => {
  for (let i = 0; i < 30; i++) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'cf-connecting-ip': `192.0.2.${i + 1}` },
      payload: { username: `random-${i}`, password: 'bad' },
    });
    expect(response.statusCode).toBe(401);
  }
  const blocked = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'cf-connecting-ip': '192.0.2.100' },
    payload: credentials,
  });
  expect(blocked.statusCode).toBe(429);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM login_attempts').get()).toEqual({ count: 31 });
});

it('не доверяет заголовкам прокси с удалённого соединения и X-Forwarded-For', async () => {
  for (let i = 0; i < 8; i++)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/auth/login',
          remoteAddress: '203.0.113.10',
          headers: { 'cf-connecting-ip': `192.0.2.${i}`, 'x-forwarded-for': `192.0.2.${i}` },
          payload: { ...credentials, password: 'bad' },
        })
      ).statusCode,
    ).toBe(401);
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress: '203.0.113.10',
    headers: { 'cf-connecting-ip': '192.0.2.250', 'x-forwarded-proto': 'https' },
    payload: credentials,
  });
  expect(response.statusCode).toBe(429);
});

it('ограничивает тело запроса и не показывает stacktrace/SQL', async () => {
  const headers = await login();
  const response = await app.inject({
    method: 'POST',
    url: '/students',
    headers,
    payload: { ...studentInput, name: 'x'.repeat(20_000) },
  });
  expect(response.statusCode).toBe(413);
  expect(response.json()).toHaveProperty('details');
  expect(response.body).not.toMatch(/at \w+|SELECT |INSERT |node_modules/);
  expect(service.students()).toHaveLength(0);
});

it('ограничивает короткий всплеск запросов без нагрузки на боевой сервер', async () => {
  const responses = await Promise.all(
    Array.from({ length: 65 }, () =>
      app.inject({
        method: 'POST',
        url: '/auth/logout',
      }),
    ),
  );
  expect(responses.filter((response) => response.statusCode === 204)).toHaveLength(60);
  expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(5);
  expect((await app.inject('/health')).statusCode).toBe(200);
  expect(app.initialConfig.bodyLimit).toBe(16 * 1024);
  expect(app.server.requestTimeout).toBe(15_000);
  expect(app.server.headersTimeout).toBe(10_000);
  expect(app.server.maxConnections).toBe(200);
});

it('ограничивает общий поток и число IP-бакетов, восстанавливает доступ после окна', () => {
  vi.useFakeTimers();
  const limiter = new RequestLimiter();
  for (let i = 0; i < 1200; i++) limiter.take('global', 1200);
  expect(() => limiter.take('global', 1200)).toThrow('Слишком много');
  vi.advanceTimersByTime(60_001);
  expect(() => limiter.take('global', 1200)).not.toThrow();
  for (let i = 0; i < 2047; i++) limiter.take(`ip:${i}`, 240);
  expect(() => limiter.take('overflow', 240)).toThrow('Слишком много');
  vi.advanceTimersByTime(60_001);
  expect(() => limiter.take('overflow', 240)).not.toThrow();
});

it('ограничивает число сессий, хранит только хеши и отзывает токены после выхода', () => {
  const auth = new AuthService(db, credentials);
  const tokens = Array.from({ length: 25 }, () => auth.login('owner', credentials.password, 'ip'));
  const stored = db.prepare('SELECT token_hash FROM web_sessions').all() as {
    token_hash: string;
  }[];
  expect(stored).toHaveLength(20);
  expect(stored.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash))).toBe(true);
  expect(stored.every((row) => !tokens.includes(row.token_hash))).toBe(true);
  const last = tokens.at(-1)!;
  expect(auth.username(last)).toBe('owner');
  auth.logout(last);
  expect(auth.username(last)).toBeNull();
});

it('возвращает защитные заголовки и закрывает API от кеширования', async () => {
  const response = await app.inject('/health');
  expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers['content-security-policy']).toContain("object-src 'none'");
  expect(response.headers['x-frame-options']).toBe('DENY');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
});
