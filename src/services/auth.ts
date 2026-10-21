import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { AccountService, passwordHash, passwordMatches } from './accounts.js';
import type { StaffUser } from '../contracts.js';
export interface WebAuth {
  username: string;
  password: string;
}
export const SESSION_COOKIE = 'ledger_v2_session';
export const SESSION_SECONDS = 12 * 60 * 60;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let dummyPasswordHash: string | undefined;
export class AuthService {
  public readonly accounts: AccountService;
  constructor(
    private readonly db: Database.Database,
    credentials: WebAuth,
    ownerTelegramId?: number,
  ) {
    this.accounts = new AccountService(db);
    this.accounts.bootstrap(credentials.username, credentials.password, ownerTelegramId);
  }
  login(username: string, password: string, client: string): string {
    const now = Date.now();
    const keys = [`ip:${hash(client)}`, 'account:staff-login'];
    this.db.prepare('DELETE FROM login_attempts WHERE expires_at<=?').run(now);
    const attempts = keys.map(
      (key) =>
        this.db
          .prepare('SELECT count,expires_at AS expiresAt FROM login_attempts WHERE key=?')
          .get(key) as { count: number; expiresAt: number } | undefined,
    );
    const blocked = attempts.find(
      (attempt, index) => attempt && attempt.count >= (index === 0 ? 8 : 30),
    );
    if (blocked)
      throw new AppError(429, 'Слишком много попыток входа. Попробуйте позже.', {
        retryAfter: Math.max(1, Math.ceil((blocked.expiresAt - now) / 1000)),
      });
    const row = this.db
      .prepare(
        'SELECT id,password_hash AS hash,active,session_version AS version FROM staff_users WHERE username=? COLLATE NOCASE',
      )
      .get(username) as { id: number; hash: string; active: number; version: number } | undefined;
    dummyPasswordHash ??= passwordHash(randomBytes(24).toString('hex'));
    const valid = passwordMatches(password, row?.hash ?? dummyPasswordHash);
    if (!row || !row.active || !valid) {
      this.db.transaction(() => {
        for (const key of keys)
          this.db
            .prepare(
              'INSERT INTO login_attempts(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
            )
            .run(key, now + 15 * 60_000);
      })();
      throw new AppError(401, 'Неверный логин или пароль');
    }
    this.db.prepare('DELETE FROM login_attempts WHERE key IN (?,?)').run(...keys);
    const token = randomBytes(32).toString('base64url');
    this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM web_sessions WHERE expires_at<=? OR (user_id=? AND credential_version<>?)',
        )
        .run(now, row.id, String(row.version));
      this.db
        .prepare(
          'INSERT INTO web_sessions(token_hash,credential_version,expires_at,user_id) VALUES(?,?,?,?)',
        )
        .run(hash(token), String(row.version), now + SESSION_SECONDS * 1000, row.id);
      this.db
        .prepare(
          'DELETE FROM web_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM web_sessions WHERE user_id=? ORDER BY expires_at DESC,rowid DESC LIMIT 20)',
        )
        .run(row.id, row.id);
    })();
    return token;
  }
  user(token: string | undefined): StaffUser | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db
      .prepare(
        'SELECT u.id FROM web_sessions s JOIN staff_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.credential_version=CAST(u.session_version AS TEXT) AND u.active=1',
      )
      .get(hash(token), Date.now()) as { id: number } | undefined;
    return row ? this.accounts.user(row.id) : null;
  }
  username(token: string | undefined): string | null {
    return this.user(token)?.username ?? null;
  }
  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM web_sessions WHERE token_hash=?').run(hash(token));
  }
}
export function sessionToken(cookie: string | undefined): string | undefined {
  return cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}
