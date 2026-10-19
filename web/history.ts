import { useSyncExternalStore } from 'react';
import type { PaymentPage } from '../src/contracts';
import { api } from './api';

interface HistoryState extends PaymentPage {
  loadedAt: number;
  loadingMore: boolean;
  error: string;
}
const cache = new Map<number, HistoryState>();
const pending = new Map<number, Promise<void>>();
const listeners = new Set<() => void>();
const controllers = new Map<number, AbortController>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function invalidateHistory(id?: number): void {
  if (id === undefined) {
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    cache.clear();
    pending.clear();
  } else {
    controllers.get(id)?.abort();
    controllers.delete(id);
    cache.delete(id);
    pending.delete(id);
  }
  notify();
}

export function prefetchHistory(id: number, more = false): Promise<void> {
  const previous = cache.get(id);
  if (pending.has(id)) return pending.get(id)!;
  if (!more && previous && Date.now() - previous.loadedAt < 60_000) return Promise.resolve();
  if (more && !previous?.nextCursor) return Promise.resolve();
  // Bound the cache even during a long session with many students.
  if (!cache.has(id) && cache.size >= 50) {
    const oldest = [...cache.entries()].find(([key]) => !pending.has(key));
    if (oldest) cache.delete(oldest[0]);
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  if (previous && more) cache.set(id, { ...previous, loadingMore: true, error: '' });
  const cursor = more && previous?.nextCursor ? `&cursor=${previous.nextCursor}` : '';
  const promise = api<PaymentPage>(`/students/${id}/payments?limit=10${cursor}`, {
    signal: controller.signal,
  })
    .then((page) => {
      if (controller.signal.aborted) return;
      // De-duplicate if a record was inserted between pages; order uses date + id.
      const items = more && previous ? [...previous.items, ...page.items] : page.items;
      cache.set(id, {
        ...page,
        items: items.filter(
          (item, index) => items.findIndex((other) => other.id === item.id) === index,
        ),
        loadedAt: more && previous ? previous.loadedAt : Date.now(),
        loadingMore: false,
        error: '',
      });
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Не удалось загрузить историю';
      if (previous) cache.set(id, { ...previous, loadingMore: false, error: message });
      throw error;
    })
    .finally(() => {
      if (controllers.get(id) === controller) {
        controllers.delete(id);
        pending.delete(id);
        notify();
      }
    });
  pending.set(id, promise);
  notify();
  return promise;
}

export function useHistory(id: number): HistoryState | undefined {
  return useSyncExternalStore(subscribe, () => cache.get(id));
}
