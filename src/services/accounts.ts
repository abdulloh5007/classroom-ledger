import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { idSchema, staffCreateSchema, staffPatchSchema, type StaffUser } from '../contracts.js';
import { AppError } from '../errors.js';

const columns =
  'id, username, name, role, active, must_change_password AS mustChangePassword, telegram_id AS telegramId, created_at AS createdAt';
type UserRow = Omit<StaffUser, 'active' | 'mustChangePassword' | 'groupIds'> & {
  active: number;
  mustChangePassword: number;
};
export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export function passwordMatches(password: string, encoded: string): boolean {
  const [kind, n, r, p, salt, key] = encoded.split('$');
  if (
    kind !== 'scrypt' ||
    n !== '32768' ||
    r !== '8' ||
    p !== '3' ||
    !salt ||
    !key ||
    !/^[a-f0-9]{128}$/.test(key)
  )
    return false;
  const actual = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
export class AccountService {
  constructor(public readonly db: Database.Database) {}
  user(rawId: unknown): StaffUser {
    const id = idSchema.parse(rawId);
    const row = this.db.prepare(`SELECT ${columns} FROM staff_users WHERE id=?`).get(id) as
      UserRow | undefined;
    if (!row) throw new AppError(404, 'Сотрудник не найден');
    const groupIds = (
      this.db
        .prepare('SELECT group_id AS id FROM staff_groups WHERE user_id=? ORDER BY group_id')
        .all(id) as { id: number }[]
    ).map((item) => item.id);
    return {
      ...row,
      active: Boolean(row.active),
      mustChangePassword: Boolean(row.mustChangePassword),
      groupIds,
    };
  }
  active(rawId: unknown): StaffUser {
    const user = this.user(rawId);
    if (!user.active) throw new AppError(403, 'Доступ сотрудника отключён');
    return user;
  }
  owner(actorId: number): StaffUser {
    const actor = this.active(actorId);
    if (actor.role !== 'owner') throw new AppError(403, 'Только для владельца');
    return actor;
  }
  bootstrap(username: string, password: string, telegramId?: number): StaffUser {
    return this.db
      .transaction(() => {
        let owner = this.db
          .prepare(
            "SELECT id, username, password_hash AS passwordHash, bootstrap_managed AS managed FROM staff_users WHERE role='owner'",
          )
          .get() as
          { id: number; username: string; passwordHash: string; managed: number } | undefined;
        const importLegacyAdmins = !owner;
        if (!owner) {
          const result = this.db
            .prepare(
              "INSERT INTO staff_users(username,name,password_hash,role,must_change_password,telegram_id,bootstrap_managed) VALUES(?,?,?,'owner',0,?,1)",
            )
            .run(username, 'Владелец', passwordHash(password), telegramId ?? null);
          owner = { id: Number(result.lastInsertRowid), username, passwordHash: '', managed: 0 };
        } else if (
          owner.managed &&
          (owner.username !== username || !passwordMatches(password, owner.passwordHash))
        ) {
          this.db
            .prepare(
              'UPDATE staff_users SET username=?,password_hash=?,session_version=session_version+1 WHERE id=?',
            )
            .run(username, passwordHash(password), owner.id);
        }
        if (telegramId) {
          const conflict = this.db
            .prepare('SELECT id FROM staff_users WHERE telegram_id=? AND id<>?')
            .get(telegramId, owner.id);
          if (conflict) throw new AppError(409, 'Telegram ID владельца уже занят');
          this.db
            .prepare('UPDATE staff_users SET telegram_id=? WHERE id=?')
            .run(telegramId, owner.id);
        }
        if (importLegacyAdmins) {
          // Import v1 access only on first owner bootstrap; later starts must not restore revoked IDs.
          for (const old of this.db.prepare('SELECT telegram_id AS id FROM admins').all() as {
            id: number;
          }[]) {
            if (old.id === telegramId || this.byTelegram(old.id)) continue;
            this.db
              .prepare(
                "INSERT INTO staff_users(username,name,password_hash,role,telegram_id,created_by) VALUES(?,?,?,'admin',?,?)",
              )
              .run(
                'tg_' + old.id,
                'Telegram ' + old.id,
                passwordHash(randomBytes(32).toString('base64url')),
                old.id,
                owner.id,
              );
          }
        }
        return this.user(owner.id);
      })
      .immediate();
  }
  byTelegram(telegramId: number): StaffUser | undefined {
    const row = this.db
      .prepare('SELECT id FROM staff_users WHERE telegram_id=?')
      .get(telegramId) as { id: number } | undefined;
    return row ? this.user(row.id) : undefined;
  }
  list(actorId: number): StaffUser[] {
    this.owner(actorId);
    return (
      this.db.prepare('SELECT id FROM staff_users ORDER BY id').all() as { id: number }[]
    ).map((row) => this.user(row.id));
  }
  create(actorId: number, input: unknown): StaffUser {
    this.owner(actorId);
    const data = staffCreateSchema.parse(input);
    return this.db
      .transaction(() => {
        this.checkUnique(data.username, data.telegramId ?? null);
        this.checkGroups(data.groupIds);
        const result = this.db
          .prepare(
            'INSERT INTO staff_users(username,name,password_hash,role,telegram_id,created_by) VALUES(?,?,?,?,?,?)',
          )
          .run(
            data.username,
            data.name,
            passwordHash(data.password),
            data.role,
            data.telegramId ?? null,
            actorId,
          );
        const id = Number(result.lastInsertRowid);
        this.assign(id, data.groupIds);
        this.audit(actorId, 'staff.create', 'staff', id, { role: data.role });
        return this.user(id);
      })
      .immediate();
  }
  update(actorId: number, rawId: unknown, input: unknown): StaffUser {
    this.owner(actorId);
    const patch = staffPatchSchema.parse(input);
    return this.db
      .transaction(() => {
        const old = this.user(rawId);
        if (old.role === 'owner')
          throw new AppError(
            400,
            'Владелец меняет свой пароль в профиле; его роль и доступ защищены',
          );
        const data = { ...old, ...patch };
        this.checkUnique(data.username, data.telegramId, old.id);
        this.checkGroups(data.groupIds);
        this.db
          .prepare(
            'UPDATE staff_users SET username=?,name=?,role=?,active=?,telegram_id=?,session_version=session_version+1 WHERE id=?',
          )
          .run(data.username, data.name, data.role, Number(data.active), data.telegramId, old.id);
        if (patch.password)
          this.db
            .prepare('UPDATE staff_users SET password_hash=?,must_change_password=1 WHERE id=?')
            .run(passwordHash(patch.password), old.id);
        this.assign(old.id, data.groupIds);
        this.audit(actorId, 'staff.update', 'staff', old.id, {
          fields: Object.keys(patch).filter((key) => key !== 'password'),
          passwordReset: Boolean(patch.password),
        });
        return this.user(old.id);
      })
      .immediate();
  }
  changePassword(actorId: number, current: string, next: string): void {
    this.active(actorId);
    if (next.length < 8 || next.length > 128)
      throw new AppError(400, 'Новый пароль: 8–128 символов');
    const row = this.db
      .prepare('SELECT password_hash AS hash FROM staff_users WHERE id=?')
      .get(actorId) as { hash: string };
    if (!passwordMatches(current, row.hash)) throw new AppError(400, 'Текущий пароль неверен');
    if (current === next) throw new AppError(400, 'Выберите новый пароль');
    this.db
      .transaction(() => {
        this.db
          .prepare(
            'UPDATE staff_users SET password_hash=?,must_change_password=0,bootstrap_managed=0,session_version=session_version+1 WHERE id=?',
          )
          .run(passwordHash(next), actorId);
        this.db.prepare('DELETE FROM web_sessions WHERE user_id=?').run(actorId);
        this.audit(actorId, 'password.change', 'staff', actorId);
      })
      .immediate();
  }
  audit(
    actorId: number | null,
    action: string,
    targetType: string,
    targetId?: number,
    details: Record<string, unknown> = {},
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_events(actor_id,action,target_type,target_id,details) VALUES(?,?,?,?,?)',
      )
      .run(actorId, action, targetType, targetId ?? null, JSON.stringify(details));
  }
  events(actorId: number, before?: number): unknown[] {
    this.owner(actorId);
    return this.db
      .prepare(
        'SELECT a.id,a.action,a.target_type AS targetType,a.target_id AS targetId,a.details,a.created_at AS createdAt,u.name AS actor FROM audit_events a LEFT JOIN staff_users u ON u.id=a.actor_id WHERE (? IS NULL OR a.id<?) ORDER BY a.id DESC LIMIT 50',
      )
      .all(before ?? null, before ?? null);
  }
  private checkUnique(username: string, telegramId: number | null, except = 0): void {
    if (
      this.db
        .prepare(
          'SELECT id FROM staff_users WHERE id<>? AND (username=? COLLATE NOCASE OR (? IS NOT NULL AND telegram_id=?))',
        )
        .get(except, username, telegramId, telegramId)
    )
      throw new AppError(409, 'Логин или Telegram ID уже используется');
  }
  private checkGroups(ids: number[]): void {
    if (new Set(ids).size !== ids.length) throw new AppError(400, 'Группы не должны повторяться');
    for (const id of ids)
      if (!this.db.prepare('SELECT 1 FROM student_groups WHERE id=?').get(id))
        throw new AppError(404, 'Группа не найдена');
  }
  private assign(userId: number, ids: number[]): void {
    this.db.prepare('DELETE FROM staff_groups WHERE user_id=?').run(userId);
    for (const id of ids)
      this.db.prepare('INSERT INTO staff_groups(user_id,group_id) VALUES(?,?)').run(userId, id);
  }
}
