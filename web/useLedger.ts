import { useCallback, useEffect, useRef, useState } from 'react';
import type { Course, Debtor, Student } from '../src/contracts';
import { currentMonth, shiftMonth } from '../src/calendar';
import { api } from './api';

export function useLedger(month: string) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsReady, setStudentsReady] = useState(false);
  const [months, setMonths] = useState<Record<string, Debtor[]>>({});
  const [studentsError, setStudentsError] = useState('');
  const [monthError, setMonthError] = useState('');
  const [revision, setRevision] = useState(0);
  const cache = useRef(new Map<string, { rows: Debtor[]; at: number }>());
  const pending = useRef(new Map<string, Promise<void>>());
  const requests = useRef(new Set<AbortController>());
  const generation = useRef({ value: 0 });
  const selectedMonth = useRef(month);
  selectedMonth.current = month;
  const loadMonth = useCallback((key: string): Promise<void> => {
    if (key > currentMonth()) return Promise.resolve();
    if (pending.current.has(key)) return pending.current.get(key)!;
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.at < 60_000) return Promise.resolve();
    const controller = new AbortController();
    const version = generation.current.value;
    requests.current.add(controller);
    const task = api<Debtor[]>(`/balances?month=${key}`, { signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted || version !== generation.current.value) return;
        cache.current.delete(key);
        cache.current.set(key, { rows, at: Date.now() });
        if (cache.current.size > 18) {
          const oldest = [...cache.current.keys()].find((key) => key !== selectedMonth.current);
          if (oldest) cache.current.delete(oldest);
        }
        setMonths(
          Object.fromEntries([...cache.current].map(([name, value]) => [name, value.rows])),
        );
      })
      .finally(() => {
        requests.current.delete(controller);
        if (version === generation.current.value) pending.current.delete(key);
      });
    pending.current.set(key, task);
    return task;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setStudentsError('');
    void Promise.all([
      api<Student[]>('/students', { signal: controller.signal }),
      api<Course[]>('/courses', { signal: controller.signal }),
    ])
      .then(([rows, courses]) => {
        if (!controller.signal.aborted) {
          setStudents(rows);
          setCourses(courses);
          setStudentsReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setStudentsError(
            error instanceof Error ? error.message : 'Не удалось загрузить учеников',
          );
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    let active = true;
    setMonthError('');
    void loadMonth(month)
      .catch((error: unknown) => {
        if (active)
          setMonthError(error instanceof Error ? error.message : 'Не удалось загрузить месяц');
      })
      .then(() => {
        if (!active) return;
        for (const offset of [-2, -1, 1, 2]) {
          try {
            void loadMonth(shiftMonth(month, offset)).catch(() => undefined);
          } catch {
            /* Month is outside the supported calendar range. */
          }
        }
      });
    return () => {
      active = false;
    };
  }, [month, revision, loadMonth]);
  useEffect(() => {
    const controllers = requests.current;
    const jobs = pending.current;
    const lifetime = generation.current;
    return () => {
      lifetime.value++;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      jobs.clear();
    };
  }, []);
  const reload = useCallback(() => {
    generation.current.value++;
    requests.current.forEach((controller) => controller.abort());
    requests.current.clear();
    pending.current.clear();
    cache.current.clear();
    setMonths({});
    setStudentsReady(false);
    setRevision((value) => value + 1);
  }, []);
  return {
    students,
    courses,
    months,
    studentsError,
    monthError,
    reload,
    ready: studentsReady,
    loading: !studentsReady || (month <= currentMonth() && !months[month]),
  };
}
