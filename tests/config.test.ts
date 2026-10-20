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
