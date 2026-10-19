import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../web/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('повторяет GET после временной 530 и возвращает данные', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('Cloudflare unavailable', { status: 530 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = api<{ ok: boolean }>('/health');
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('не повторяет POST оплаты после 530', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('Cloudflare unavailable', { status: 530 }));
  vi.stubGlobal('fetch', fetch);
  await expect(api('/students/1/payments', { method: 'POST', body: '{}' })).rejects.toThrow(
    'Cloudflare',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('не повторяет 400 и останавливается после трёх неудачных GET', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response('{}', { status: 503 })));
  vi.stubGlobal('fetch', fetch);
  const result = expect(api('/health')).rejects.toThrow('503');
  await vi.runAllTimersAsync();
  await result;
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch.mockClear();
  fetch.mockResolvedValue(new Response('{"error":"Некорректный запрос"}', { status: 400 }));
  await expect(api('/health')).rejects.toThrow('Некорректный');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('отменяет повтор при выходе со страницы или истечении сессии', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 530 }));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const result = expect(api('/health', { signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await vi.runAllTimersAsync();
  await result;
  expect(fetch).toHaveBeenCalledTimes(1);
});
