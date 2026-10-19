import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';

export interface WebAuth {
  username: string;
  password: string;
}
export const SESSION_COOKIE = 'ledger_session';
export const SESSION_SECONDS = 12 * 60 * 60;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export class AuthService {
  private readonly credentialVersion: string;
  constructor(
    private readonly db: Database.Database,
    private readonly credentials: WebAuth,
  ) {
    this.credentialVersion = hash(JSON.stringify([credentials.username, credentials.password]));
  }
  login(username: string, password: string, client: string): string {
    const now = Date.now();
    // One account exists: a shared limit also covers rotated IPs and random usernames.
    const keys = [`ip:${hash(client)}`, `account:${this.credentialVersion}`];
    this.db.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').run(now);
    const attempts = keys.map(
      (key) =>
        this.db
          .prepare('SELECT count, expires_at AS expiresAt FROM login_attempts WHERE key=?')
          .get(key) as { count: number; expiresAt: number } | undefined,
    );
    const blocked = attempts.find(
      (attempt, index) => attempt && attempt.count >= (index === 0 ? 8 : 30),
    );
    if (blocked)
      throw new AppError(429, 'Слишком много попыток входа. Попробуйте позже.', {
        retryAfter: Math.max(1, Math.ceil((blocked.expiresAt - now) / 1000)),
      });
    const actual = Buffer.from(hash(JSON.stringify([username, password])), 'hex');
    if (!timingSafeEqual(actual, Buffer.from(this.credentialVersion, 'hex'))) {
      this.db.transaction(() => {
        keys.forEach((key) =>
          this.db
            .prepare(
              `
          INSERT INTO login_attempts(key, count, expires_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET count=count+1
        `,
            )
            .run(key, now + 15 * 60_000),
        );
      })();
      throw new AppError(401, 'Неверный логин или пароль');
    }
    this.db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').run(...keys);
    const token = randomBytes(32).toString('base64url');
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM web_sessions WHERE expires_at <= ? OR credential_version != ?')
        .run(now, this.credentialVersion);
      this.db
        .prepare(
          'INSERT INTO web_sessions(token_hash, credential_version, expires_at) VALUES (?, ?, ?)',
        )
        .run(hash(token), this.credentialVersion, now + SESSION_SECONDS * 1000);
      this.db
        .prepare(
          'DELETE FROM web_sessions WHERE token_hash NOT IN (SELECT token_hash FROM web_sessions ORDER BY expires_at DESC, rowid DESC LIMIT 20)',
        )
        .run();
    })();
    return token;
  }
  username(token: string | undefined): string | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = this.db
      .prepare(
        'SELECT 1 FROM web_sessions WHERE token_hash=? AND credential_version=? AND expires_at>?',
      )
      .get(hash(token), this.credentialVersion, Date.now());
    return session ? this.credentials.username : null;
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
