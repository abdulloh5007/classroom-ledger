import { afterEach, expect, it, vi } from 'vitest';
async function load(content: string) {
  vi.resetModules();
  vi.doMock('node:fs', () => ({
    existsSync: () => true,
    readFileSync: () => Buffer.from(content),
  }));
  return (await import('../src/config')).config;
}
afterEach(() => {
  vi.doUnmock('node:fs');
  vi.resetModules();
  vi.unstubAllEnvs();
});
it('читает шестисимвольный пароль и логин из файла настроек', async () => {
  vi.stubEnv('WEB_PASSWORD', 'ignored-environment-password');
  const config = await load('WEB_USERNAME=admin\nWEB_PASSWORD=abc123\n');
  expect(config.webAuth).toEqual({ username: 'admin', password: 'abc123' });
});
it('отклоняет пароль короче шести символов', async () => {
  await expect(load('WEB_PASSWORD=abc12\n')).rejects.toThrow('минимум 6 символов');
});
it('пустой пароль сохраняет локальный режим без входа', async () => {
  expect((await load('WEB_PASSWORD=\n')).webAuth).toBeUndefined();
});

it('preview запрещает запуск рабочего бота', async () => {
  await expect(load('BOT_TOKEN=12345:fake-for-test\nOWNER_ID=123\n')).rejects.toThrow('preview');
});
it('preview запрещает путь рабочей или внешней базы', async () => {
  for (const path of ['./data/app.db', '../data/preview.db', '/tmp/preview.db'])
    await expect(load('DB_PATH=' + path + '\n')).rejects.toThrow('отдельную БД');
});

it('production не допускает случайного запуска без пароля', async () => {
  await expect(load('APP_STAGE=production\nWEB_PASSWORD=\n')).rejects.toThrow('WEB_PASSWORD');
});
