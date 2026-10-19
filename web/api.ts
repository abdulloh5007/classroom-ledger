export class ApiError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...options?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Нет связи с сервером. Проверьте подключение и повторите.');
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('ledger:session-expired'));
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      details?: { fieldErrors?: Record<string, string[]> };
    } | null;
    throw new ApiError(
      body?.error ?? `Ошибка сервера (${response.status})`,
      body?.details?.fieldErrors,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
