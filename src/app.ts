import Fastify from 'fastify';
import { z } from 'zod';
import {
  AuthService,
  SESSION_COOKIE,
  SESSION_SECONDS,
  sessionToken,
  type WebAuth,
} from './services/auth.js';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import type { LedgerService } from './services/ledger.js';
import { registerRoutes } from './routes.js';
import { clientIp, secureRequest, RequestLimiter } from './security.js';

export function createApp(service: LedgerService, logger = false, webAuth?: WebAuth) {
  const app = Fastify({
    logger: logger
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'] }
      : false,
    bodyLimit: 16 * 1024,
    requestTimeout: 15_000,
    connectionTimeout: 15_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 100,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
  });
  app.server.maxConnections = 200;
  app.server.headersTimeout = 10_000;
  const limiter = new RequestLimiter();
  const auth = webAuth ? new AuthService(service.db, webAuth) : undefined;
  app.addHook('onRequest', async (request) => {
    limiter.take('global', 1200);
    limiter.take(`ip:${clientIp(request)}`, 240);
    if (request.routeOptions.url === '/auth/login') limiter.take('login', 60);
    if (['POST', 'PATCH', 'DELETE'].includes(request.method))
      limiter.take(`write:${clientIp(request)}`, 60);
    // CORS is not enabled. Block cross-origin browser mutations as well.
    if (['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      if (request.headers['sec-fetch-site'] === 'cross-site')
        throw new AppError(403, 'Запрос с другого сайта запрещён');
      if (request.headers.origin) {
        let origin: URL;
        try {
          origin = new URL(request.headers.origin);
        } catch {
          throw new AppError(403, 'Недопустимый Origin');
        }
        const expectedProtocol = secureRequest(request) ? 'https:' : 'http:';
        if (
          origin.origin !== new URL(`${expectedProtocol}//${request.headers.host}`).origin ||
          origin.username ||
          origin.password
        )
          throw new AppError(403, 'Запрос с другого сайта запрещён');
      }
    }
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    const development = !(
      process.env.NODE_ENV === 'production' || process.argv[1]?.endsWith('/dist/server/main.js')
    );
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data:",
        `connect-src 'self'${development ? ' ws: wss:' : ''}`,
      ].join('; '),
    );
    if (secureRequest(request)) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (auth || request.url.startsWith('/auth/'))
      reply.header('Cache-Control', 'private, no-store');
  });
  const cookie = (token: string, secure: boolean, maxAge: number) =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  app.get('/auth/session', async (request) => ({
    authenticationRequired: Boolean(auth),
    username: auth?.username(sessionToken(request.headers.cookie)) ?? null,
  }));
  app.post('/auth/login', async (request, reply) => {
    const data = z
      .object({
        username: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .parse(request.body);
    if (!auth) throw new AppError(400, 'Вход для локального режима не требуется');
    const token = auth.login(data.username, data.password, clientIp(request));
    reply.header('Set-Cookie', cookie(token, secureRequest(request), SESSION_SECONDS));
    return { authenticationRequired: true, username: data.username };
  });
  app.post('/auth/logout', async (request, reply) => {
    auth?.logout(sessionToken(request.headers.cookie));
    reply.header('Set-Cookie', cookie('', secureRequest(request), 0));
    return reply.code(204).send();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: 'Ошибка валидации', details: error.flatten() });
    if (error instanceof AppError) {
      if (
        error.statusCode === 429 &&
        error.details &&
        typeof error.details === 'object' &&
        'retryAfter' in error.details &&
        typeof error.details.retryAfter === 'number'
      )
        reply.header('Retry-After', error.details.retryAfter);
      return reply.code(error.statusCode).send({ error: error.message, details: error.details });
    }
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({ error: error.message, details: null });
    request.log.error('Internal application error');
    return reply.code(500).send({ error: 'Внутренняя ошибка сервера', details: null });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'Маршрут не найден', details: null }),
  );
  app.get('/health', async () => ({ status: 'ok' }));
  // Encapsulation attaches authentication to matched routes before body parsing.
  // It does not rely on the spelling/encoding of the incoming URL.
  app.register(async (protectedApi) => {
    protectedApi.addHook('onRequest', async (request, reply) => {
      if (auth && !auth.username(sessionToken(request.headers.cookie)))
        return reply.code(401).send({ error: 'Сессия завершена. Войдите снова.', details: null });
    });
    registerRoutes(protectedApi, service);
  });
  return app;
}
