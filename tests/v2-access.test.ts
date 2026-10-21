import { afterEach, beforeEach, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { AccountService } from '../src/services/accounts.js';
import { AuthService } from '../src/services/auth.js';
import { createApp } from '../src/app.js';
let db: Database.Database, ledger: LedgerService, accounts: AccountService;
const ownerCredentials = { username: 'preview-owner', password: 'isolated-owner-password' };
beforeEach(() => {
  db = openDatabase(':memory:');
  ledger = new LedgerService(db, 123);
  accounts = new AccountService(db);
  accounts.bootstrap(ownerCredentials.username, ownerCredentials.password, 123);
});
afterEach(() => db.close());
function setup() {
  const course = ledger.createCourse({ name: 'English', monthlyAmount: 1000 });
  const own = ledger.createGroup({ name: 'Own', courseId: course.id, startsOn: '2026-10-01' });
  const other = ledger.createGroup({ name: 'Other', courseId: course.id, startsOn: '2026-10-01' });
  const student = ledger.createStudent({
    name: 'Own pupil',
    phone: '+998901234567',
    groupId: own.id,
    enrolledOn: '2026-10-01',
  });
  const stranger = ledger.createStudent({
    name: 'Other pupil',
    phone: '+998901234567',
    groupId: other.id,
    enrolledOn: '2026-10-01',
  });
  const owner = accounts.byTelegram(123)!;
  const teacher = accounts.create(owner.id, {
    username: 'teacher',
    name: 'Teacher',
    password: 'temporary-teacher-password',
    role: 'teacher',
    telegramId: 456,
    groupIds: [own.id],
  });
  return {
    course,
    own,
    other,
    student,
    stranger,
    owner,
    teacher,
    scoped: ledger.asUser(teacher.id),
  };
}
it('учитель видит только назначенные группы, учеников и баланс', () => {
  const { own, student, scoped } = setup();
  expect(scoped.groups().map((group) => group.id)).toEqual([own.id]);
  expect(scoped.students().map((row) => row.id)).toEqual([student.id]);
  expect(scoped.monthlyBalances('2026-10').map((row) => row.studentId)).toEqual([student.id]);
});
it('подмена ID не даёт учителю чужие чтения, изменения и оплату', () => {
  const { other, stranger, scoped } = setup();
  for (const action of [
    () => scoped.group(other.id),
    () => scoped.student(stranger.id),
    () => scoped.payments(stranger.id),
    () => scoped.addPayment(stranger.id, { amount: 100, date: '2026-10-21' }),
    () => scoped.updateGroup(other.id, { name: 'Changed' }),
    () => scoped.deleteStudent(stranger.id),
  ])
    expect(action).toThrow();
  expect(ledger.student(stranger.id).name).toBe('Other pupil');
});
it('учитель не меняет цену через курс, группу или старый контракт ученика', () => {
  const { course, own, scoped } = setup();
  expect(() => scoped.updateCourse(course.id, { monthlyAmount: 2000 })).toThrow('курсы и цены');
  expect(() => scoped.updateGroup(own.id, { monthlyAmount: 2000 })).toThrow('курсы и цены');
  expect(() =>
    scoped.createStudent({ name: 'X', phone: '+998901234567', group: 'Bypass', monthlyAmount: 1 }),
  ).toThrow();
  expect(ledger.course(course.id).monthlyAmount).toBe(1000);
});
it('учитель создаёт свою группу, ведёт её учеников, но не выдаёт роли', () => {
  const { course, teacher, owner, scoped } = setup();
  const group = scoped.createGroup({
    name: 'Teacher new',
    courseId: course.id,
    startsOn: '2026-11-01',
  });
  expect(accounts.user(teacher.id).groupIds).toContain(group.id);
  const student = scoped.createStudent({
    name: 'New',
    phone: '+998901234567',
    groupId: group.id,
    enrolledOn: '2026-11-01',
  });
  expect(scoped.student(student.id).name).toBe('New');
  expect(() =>
    accounts.create(teacher.id, {
      username: 'bad',
      name: 'Bad',
      password: 'test-only-password',
      role: 'admin',
    }),
  ).toThrow('владельца');
  expect(() => accounts.update(teacher.id, owner.id, { active: false })).toThrow('владельца');
});
it('администратор управляет курсами и группами, но не пользователями', () => {
  const { owner } = setup();
  const admin = accounts.create(owner.id, {
    username: 'admin-two',
    name: 'Admin',
    password: 'temporary-admin-password',
    role: 'admin',
  });
  const scoped = ledger.asUser(admin.id);
  expect(scoped.createCourse({ name: 'Math', monthlyAmount: 2000 }).name).toBe('Math');
  expect(scoped.groups()).toHaveLength(2);
  expect(() => accounts.list(admin.id)).toThrow('владельца');
});
it('отключение аккаунта сразу закрывает веб, бота и ранее созданный сервис', () => {
  const { owner, teacher, scoped } = setup();
  const auth = new AuthService(db, ownerCredentials, 123);
  const token = auth.login('teacher', 'temporary-teacher-password', 'fixture');
  expect(auth.username(token)).toBe('teacher');
  expect(ledger.canAccess(456)).toBe(true);
  accounts.update(owner.id, teacher.id, { active: false });
  expect(auth.username(token)).toBeNull();
  expect(ledger.canAccess(456)).toBe(false);
  expect(() => scoped.students()).toThrow('отключён');
});
it('снятый Telegram ID не восстанавливается через старую таблицу admins', () => {
  const { owner, teacher } = setup();
  db.prepare('INSERT INTO admins(telegram_id,added_by) VALUES(?,?)').run(456, 123);
  accounts.update(owner.id, teacher.id, { telegramId: null });
  expect(ledger.canAccess(456)).toBe(false);
  accounts.bootstrap(ownerCredentials.username, ownerCredentials.password, 123);
  expect(ledger.canAccess(456)).toBe(false);
});
it('смена роли или групп отзывает сессию и проверяется по актуальной записи', () => {
  const { owner, teacher, own, scoped } = setup();
  const auth = new AuthService(db, ownerCredentials, 123);
  const token = auth.login('teacher', 'temporary-teacher-password', 'fixture');
  accounts.update(owner.id, teacher.id, { groupIds: [] });
  expect(auth.username(token)).toBeNull();
  expect(() => scoped.group(own.id)).toThrow();
});
it('владелец защищён, дубликаты ID и логинов отклоняются, пароль не возвращается', () => {
  const { owner, teacher } = setup();
  expect(() => accounts.update(owner.id, owner.id, { active: false })).toThrow('защищены');
  expect(() =>
    accounts.create(owner.id, {
      username: 'other',
      name: 'X',
      password: 'test-only-password',
      role: 'teacher',
      telegramId: 456,
    }),
  ).toThrow('используется');
  expect(JSON.stringify(accounts.user(teacher.id))).not.toContain('password');
  expect(
    (
      db.prepare('SELECT password_hash AS hash FROM staff_users WHERE id=?').get(teacher.id) as {
        hash: string;
      }
    ).hash,
  ).toMatch(/^scrypt\$/);
});
it(
  'веб требует сменить временный пароль и не пускает учителя в staff API',
  { timeout: 15000 },
  async () => {
    const { teacher } = setup();
    const app = createApp(ledger, false, ownerCredentials);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: teacher.username, password: 'temporary-teacher-password' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      expect((await app.inject({ url: '/groups', headers: { cookie } })).statusCode).toBe(403);
      expect(
        (await app.inject({ url: '/auth/profile', headers: { cookie } })).json(),
      ).toMatchObject({ role: 'teacher', mustChangePassword: true });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/password',
            headers: { cookie },
            payload: {
              currentPassword: 'temporary-teacher-password',
              newPassword: 'individual-teacher-password',
            },
          })
        ).statusCode,
      ).toBe(204);
      expect((await app.inject({ url: '/groups', headers: { cookie } })).statusCode).toBe(401);
      const relogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: teacher.username, password: 'individual-teacher-password' },
      });
      const headers = { cookie: String(relogin.headers['set-cookie']).split(';')[0]! };
      expect((await app.inject({ url: '/groups', headers })).statusCode).toBe(200);
      expect((await app.inject({ url: '/staff', headers })).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  },
);

it(
  'отзыв сессии между onRequest и обработчиком не включает локальный режим без ограничений',
  { timeout: 15000 },
  async () => {
    const { owner, teacher } = setup();
    accounts.changePassword(
      teacher.id,
      'temporary-teacher-password',
      'revocation-fixture-password',
    );
    const app = createApp(ledger, false, ownerCredentials);
    app.addHook('preHandler', async (request) => {
      if (request.headers['x-fixture-revoke'] === '1')
        accounts.update(owner.id, teacher.id, { active: false });
    });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: teacher.username, password: 'revocation-fixture-password' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const result = await app.inject({
        url: '/students',
        headers: { cookie, 'x-fixture-revoke': '1' },
      });
      expect(result.statusCode).toBe(401);
      expect(result.body).not.toContain('Other pupil');
    } finally {
      await app.close();
    }
  },
);

it(
  'новые API отклоняют лишние query и небезопасный числовой курсор',
  { timeout: 15000 },
  async () => {
    const { teacher } = setup();
    const app = createApp(ledger, false, ownerCredentials);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: ownerCredentials,
      });
      const headers = { cookie: String(login.headers['set-cookie']).split(';')[0]! };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/staff?extra=1',
            headers,
            payload: {
              username: 'should-not-create',
              name: 'Invalid query',
              password: 'temporary-password',
              role: 'teacher',
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/staff/' + teacher.id + '?extra=1',
            headers,
            payload: { active: false },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await app.inject({ url: '/audit?before=9007199254740992', headers })).statusCode,
      ).toBe(400);
      expect(accounts.user(teacher.id).active).toBe(true);
      expect(db.prepare('SELECT COUNT(*) AS count FROM staff_users').get()).toEqual({ count: 2 });
    } finally {
      await app.close();
    }
  },
);

it('старые Telegram-админы импортируются однократно и не возвращаются после отвязки', () => {
  const isolated = openDatabase(':memory:');
  try {
    isolated.prepare('INSERT INTO admins(telegram_id,added_by) VALUES(?,?)').run(789, 123);
    const service = new AccountService(isolated);
    const owner = service.bootstrap('legacy-owner', 'only-local-password', 123);
    const oldAdmin = service.byTelegram(789)!;
    expect(oldAdmin.role).toBe('admin');
    service.update(owner.id, oldAdmin.id, { telegramId: null });
    service.bootstrap('legacy-owner', 'only-local-password', 123);
    expect(service.byTelegram(789)).toBeUndefined();
    expect(service.list(owner.id)).toHaveLength(2);
  } finally {
    isolated.close();
  }
});
