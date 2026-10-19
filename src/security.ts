import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['cf-connecting-ip'];
  // The server binds to loopback; only the local Cloudflare connector is trusted.
  return ['127.0.0.1', '::1'].includes(request.ip) &&
    typeof forwarded === 'string' &&
    isIP(forwarded)
    ? forwarded
    : request.ip;
}

export function secureRequest(request: FastifyRequest): boolean {
  return (
    request.protocol === 'https' ||
    (['127.0.0.1', '::1'].includes(request.ip) && request.headers['x-forwarded-proto'] === 'https')
  );
}

/** Fixed windows, bounded memory, and an aggregate limit before allocating IP entries. */
export class RequestLimiter {
  private readonly windows = new Map<string, { count: number; until: number }>();
  take(key: string, limit: number, milliseconds = 60_000): void {
    const now = Date.now();
    let entry = this.windows.get(key);
    if (!entry || entry.until <= now) {
      if (this.windows.size >= 2048) {
        for (const [oldKey, value] of this.windows)
          if (value.until <= now) this.windows.delete(oldKey);
        if (this.windows.size >= 2048)
          throw new AppError(429, 'Слишком много запросов. Повторите позже.', { retryAfter: 60 });
      }
      entry = { count: 0, until: now + milliseconds };
      this.windows.set(key, entry);
    }
    if (entry.count >= limit)
      throw new AppError(429, 'Слишком много запросов. Повторите позже.', {
        retryAfter: Math.max(1, Math.ceil((entry.until - now) / 1000)),
      });
    entry.count++;
  }
}
