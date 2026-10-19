import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';
import { LedgerService } from './services/ledger.js';
import { config } from './config.js';
import { createBot } from './bot/index.js';

const production =
  process.env.NODE_ENV === 'production' || process.argv[1]?.endsWith('/dist/server/main.js');
const db = openDatabase(config.dbPath);
const service = new LedgerService(db, config.ownerId);
const app = createApp(service, true, config.webAuth);
const telegram = config.botToken ? createBot(config.botToken, service) : undefined;
let vite: import('vite').ViteDevServer | undefined;
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  const middie = (await import('@fastify/middie')).default;
  await app.register(middie);
  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server: app.server } },
    appType: 'spa',
  });
  app.use((request, response, next) => {
    const path = request.url?.split('?')[0] ?? '/';
    if (/^\/(students|groups|courses|debtors|balances|health|auth)(\/|$)/.test(path)) {
      next();
      return;
    }
    vite!.middlewares(request, response, next);
  });
} else {
  const fastifyStatic = (await import('@fastify/static')).default;
  await app.register(fastifyStatic, {
    root: resolve('dist/web'),
    prefix: '/',
    index: ['index.html'],
  });
  app.get('/login', async (_request, reply) => reply.sendFile('index.html'));
}
async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port <= Math.min(preferred + 50, 65535); port++) {
    const free = await new Promise<boolean>((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  throw new Error('Нет свободного порта в диапазоне PORT…PORT+50');
}
app.addHook('onClose', async () => {
  await telegram?.stop();
  await vite?.close();
  db.close();
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.close();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  const port = await freePort(config.port);
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`\nКласс · http://127.0.0.1:${port}\n`);
  if (telegram)
    void telegram
      .start()
      .catch(() =>
        console.error(
          'Бот не запущен: проверьте токен, сеть, webhook и отсутствие другого polling-процесса. Веб и API продолжают работать.',
        ),
      );
  else console.log('BOT_TOKEN не задан: доступны веб и API.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Ошибка запуска');
  await app.close();
  process.exitCode = 1;
}
