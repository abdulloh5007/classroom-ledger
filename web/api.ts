export class ApiError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}
async function retryDelay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Request aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response | undefined;
  // Only reads can be replayed; retrying a payment could create a duplicate.
  const attempts = (options?.method ?? 'GET').toUpperCase() === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
          ...options?.headers,
        },
      });
      if (![502, 503, 504, 530].includes(response.status) || attempt === attempts - 1) break;
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (attempt === attempts - 1)
        throw new ApiError('Нет связи с сервером. Проверьте подключение и повторите.');
    }
    await retryDelay(attempt === 0 ? 350 : 900, options?.signal);
  }
  if (!response) throw new ApiError('Не удалось подключиться к серверу');
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('ledger:session-expired'));
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      details?: { fieldErrors?: Record<string, string[]> };
    } | null;
    throw new ApiError(
      body?.error ??
        (response.status === 530
          ? 'Временно потеряна связь с Cloudflare. Повторите через несколько секунд.'
          : `Ошибка сервера (${response.status})`),
      body?.details?.fieldErrors,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
