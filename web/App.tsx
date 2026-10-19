import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CreditCard,
  GraduationCap,
  History as HistoryIcon,
  Moon,
  LogOut,
  Pencil,
  Plus,
  Search,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { Student, Debtor } from '../src/contracts';
import { currentMonth, formatMoney, shiftMonth } from '../src/calendar';
import { api } from './api';
import { Empty, Sheet, Tip, Spinner } from './components';
import { DeleteStudent, History, PaymentForm, StudentForm } from './forms';
import { prefetchHistory } from './history';

type Modal =
  | { type: 'payment'; studentId?: number }
  | { type: 'student'; student?: Student }
  | { type: 'history' | 'delete'; student: Student };
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace(' г.', '');
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
function initialTheme(): string {
  try {
    return localStorage.getItem('ledger-theme') ?? 'system';
  } catch {
    return 'system';
  }
}
export function App({
  onLogout,
  loggingOut = false,
}: {
  onLogout?: () => Promise<void>;
  loggingOut?: boolean;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [direction, setDirection] = useState(1);
  const [tab, setTab] = useState<'debtors' | 'students'>('debtors');
  const [students, setStudents] = useState<Student[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openingHistory, setOpeningHistory] = useState<number>();
  const historyRequest = useRef(0);
  function showModal(value: Modal) {
    historyRequest.current++;
    setOpeningHistory(undefined);
    setModal(value);
    setSheetOpen(true);
  }
  async function openHistory(student: Student) {
    const request = ++historyRequest.current;
    setOpeningHistory(student.id);
    try {
      await prefetchHistory(student.id);
    } catch {
      // The drawer offers a retry if the initial prefetch fails.
    }
    if (request === historyRequest.current) showModal({ type: 'history', student });
  }
  useEffect(
    () => () => {
      historyRequest.current++;
    },
    [],
  );
  useEffect(() => {
    if (tab !== 'students' || loading) return;
    let cancelled = false;
    // Only the first visible ten students, two concurrent requests, never all histories.
    const visible = students
      .filter((student) =>
        `${student.name} ${student.phone} ${student.group}`
          .toLocaleLowerCase('ru')
          .includes(query.toLocaleLowerCase('ru')),
      )
      .slice(0, 10);
    const timer = setTimeout(() => {
      const work = async () => {
        while (!cancelled && visible.length) {
          const student = visible.shift();
          if (student) await prefetchHistory(student.id).catch(() => undefined);
        }
      };
      void Promise.all([work(), work()]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, students, query, loading]);
  const [toast, setToast] = useState<{ id: number; text: string }>();
  const [theme, setTheme] = useState(initialTheme);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const reduced = useReducedMotion();
  const activeFetch = useRef<AbortController | null>(null);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ledger-theme', theme);
    } catch {
      /* Storage can be disabled. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0a0a0a' : '#fafafa');
  }, [theme, dark]);
  const reload = useCallback(async () => {
    activeFetch.current?.abort();
    const controller = new AbortController();
    activeFetch.current = controller;
    setLoading(true);
    setError('');
    try {
      const [nextStudents, nextDebtors] = await Promise.all([
        api<Student[]>('/students', { signal: controller.signal }),
        api<Debtor[]>(`/debtors?month=${month}`, { signal: controller.signal }),
      ]);
      if (!controller.signal.aborted) {
        setStudents(nextStudents);
        setDebtors(nextDebtors);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Не удалось загрузить данные');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void reload();
    return () => activeFetch.current?.abort();
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const close = useCallback(() => setSheetOpen(false), []);
  function saved(text: string) {
    setSheetOpen(false);
    setToast({ id: Date.now(), text });
    void reload();
  }
  function changeMonth(delta: number) {
    setDirection(delta);
    setMonth((value) => shiftMonth(value, delta));
  }
  const totalDebt = debtors.reduce((sum, debtor) => sum + debtor.debt, 0);
  const filtered = students.filter((student) =>
    `${student.name} ${student.phone} ${student.group}`
      .toLocaleLowerCase('ru')
      .includes(query.toLocaleLowerCase('ru')),
  );
  const modalTitle = !modal
    ? ''
    : modal.type === 'payment'
      ? 'Внести оплату'
      : modal.type === 'student'
        ? modal.student
          ? 'Редактировать ученика'
          : 'Новый ученик'
        : modal.type === 'delete'
          ? 'Удалить ученика?'
          : 'История оплат';
  const modalDescription = !modal
    ? ''
    : modal.type === 'payment'
      ? 'Все суммы в узбекских сумах'
      : modal.type === 'student'
        ? 'Данные и месячная стоимость обучения'
        : modal.type === 'history'
          ? modal.student.name
          : 'Это действие нельзя отменить';
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Перейти к содержимому
      </a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Класс — главная">
          <span className="brand-mark">
            <BookOpen size={18} strokeWidth={1.8} />
          </span>
          <span>класс</span>
          <span className="workspace-label">учёт оплат</span>
        </a>
        <div className="topbar-actions">
          {onLogout && (
            <Tip label="Выйти">
              <button
                className="icon-button"
                aria-label="Выйти"
                onClick={() => void onLogout()}
                disabled={loggingOut}
              >
                <LogOut size={18} />
              </button>
            </Tip>
          )}
          <Tip label={dark ? 'Светлая тема' : 'Тёмная тема'}>
            <button
              className="icon-button theme-button"
              aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
              onClick={() => setTheme(dark ? 'light' : 'dark')}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </Tip>
        </div>
      </header>
      <main id="content">
        <div className="page-heading">
          <h1>Учёт оплат</h1>
        </div>
        <div className="toolbar">
          <div className="month-control" role="group" aria-label="Месяц учёта">
            <button
              className="icon-button"
              aria-label="Предыдущий месяц"
              onClick={() => changeMonth(-1)}
              disabled={month === '1900-01'}
            >
              <ChevronLeft size={18} />
            </button>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={month}
                initial={{ opacity: 0, x: reduced ? 0 : direction * 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: reduced ? 0 : direction * -8 }}
                transition={{ duration: 0.16 }}
                className="month-label"
                aria-live="polite"
              >
                {monthLabel(month)}
              </motion.span>
            </AnimatePresence>
            <button
              className="icon-button"
              aria-label="Следующий месяц"
              onClick={() => changeMonth(1)}
              disabled={month === '9999-11'}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            className="button primary"
            onClick={() => showModal({ type: 'payment' })}
            disabled={loading || !students.length}
          >
            <Plus size={17} />
            Внести оплату
          </button>
        </div>
        <div className="segment-control" role="tablist" aria-label="Раздел учёта">
          {(
            [
              { id: 'debtors', label: 'Должники', Icon: CreditCard },
              { id: 'students', label: 'Ученики', Icon: Users },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const target =
                    event.key === 'Home'
                      ? 'debtors'
                      : event.key === 'End'
                        ? 'students'
                        : tab === 'debtors'
                          ? 'students'
                          : 'debtors';
                  setTab(target);
                  document.getElementById(`tab-${target}`)?.focus();
                }
              }}
              onClick={() => setTab(id)}
            >
              {tab === id && (
                <motion.span
                  className="segment-active"
                  layoutId="segment"
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                    duration: reduced ? 0 : undefined,
                  }}
                />
              )}
              <span className="segment-text">
                <Icon size={16} />
                {label}
                <span className="count">
                  {loading ? '–' : id === 'debtors' ? debtors.length : students.length}
                </span>
              </span>
            </button>
          ))}
        </div>
        {error ? (
          <div className="network-error" role="alert">
            <p>{error}</p>
            <button className="button secondary" onClick={() => void reload()}>
              Попробовать снова
            </button>
          </div>
        ) : loading ? (
          <div className="skeletons" role="status" aria-label="Загрузка данных">
            <div className="skeleton summary-skeleton" />
            <div className="skeleton card-skeleton" />
            <div className="skeleton card-skeleton" />
            <span className="sr-only">Загружаем учеников и оплаты</span>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.section
              key={`${tab}-${month}`}
              role="tabpanel"
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
              initial={{ opacity: 0, x: reduced ? 0 : direction * 10, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: reduced ? 0 : direction * -10, y: reduced ? 0 : -6 }}
              transition={{ duration: 0.2 }}
            >
              {tab === 'debtors' ? (
                <>
                  <div className="summary-card">
                    <div className="summary-top">
                      <span>
                        <span className="status-dot" />
                        {month > currentMonth() ? 'План на месяц' : 'Осталось собрать'}
                      </span>
                    </div>
                    <p className="summary-amount">
                      {new Intl.NumberFormat('ru-RU').format(totalDebt)}
                      <span>сум</span>
                    </p>
                    <div className="summary-bottom">
                      <span>
                        Должников: {debtors.length} из {students.length}
                      </span>
                    </div>
                  </div>
                  <p className="month-note">
                    {month > currentMonth()
                      ? 'Будущий месяц: это плановая сумма, ещё не просроченный долг.'
                      : 'Учтены только оплаты за выбранный месяц. Долги других месяцев сюда не входят.'}
                  </p>
                  <div className="section-label">
                    <h2>Ожидают оплаты</h2>
                    <span>Сначала больший долг</span>
                  </div>
                  <div className="card-list">
                    <AnimatePresence initial={false}>
                      {debtors.map((debtor) => (
                        <motion.article
                          layout
                          className="debtor-card"
                          key={debtor.studentId}
                          initial={{ opacity: 0, y: reduced ? 0 : 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: reduced ? 1 : 0.97 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                        >
                          <div className="student-top">
                            <span className="avatar">{initials(debtor.name)}</span>
                            <div className="student-info">
                              <h3>{debtor.name}</h3>
                              <span>{debtor.group}</span>
                            </div>
                            <span className="student-id">#{debtor.studentId}</span>
                          </div>
                          <div className="payment-figures">
                            <div>
                              <span>Оплачено</span>
                              <strong>{formatMoney(debtor.paid)}</strong>
                            </div>
                            <div>
                              <span>Осталось</span>
                              <strong className="debt-figure">{formatMoney(debtor.debt)}</strong>
                            </div>
                          </div>
                          <div
                            className="progress"
                            role="progressbar"
                            aria-label={`Оплата ${debtor.name}`}
                            aria-valuenow={Math.round((debtor.paid / debtor.monthlyAmount) * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <motion.span
                              initial={false}
                              animate={{
                                width: `${Math.min(100, (debtor.paid / debtor.monthlyAmount) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="card-footer">
                            <a href={`tel:${debtor.phone.replace(/[^+\d]/g, '')}`}>
                              {debtor.phone}
                              <ArrowUpRight size={12} />
                            </a>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                showModal({ type: 'payment', studentId: debtor.studentId })
                              }
                            >
                              <Plus size={15} />
                              Внести оплату
                            </button>
                          </div>
                        </motion.article>
                      ))}
                    </AnimatePresence>
                  </div>
                  {!debtors.length && (
                    <Empty
                      icon={<CircleCheck size={25} />}
                      title={students.length ? 'Всё оплачено' : 'Нет учеников'}
                      text={
                        students.length
                          ? 'За выбранный месяц задолженностей нет.'
                          : 'Добавьте первого ученика, чтобы начать учёт оплат.'
                      }
                      action={
                        !students.length ? (
                          <button
                            className="button primary"
                            onClick={() => showModal({ type: 'student' })}
                          >
                            <Plus size={17} />
                            Добавить ученика
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="students-toolbar">
                    <label className="search">
                      <Search size={18} />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Имя, группа или телефон"
                        aria-label="Поиск учеников"
                      />
                      {query && (
                        <button
                          className="icon-button"
                          onClick={() => setQuery('')}
                          aria-label="Очистить поиск"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </label>
                    <Tip label="Добавить ученика">
                      <button
                        className="button primary add-student"
                        aria-label="Добавить ученика"
                        onClick={() => showModal({ type: 'student' })}
                      >
                        <Plus size={19} />
                        <span>Добавить</span>
                      </button>
                    </Tip>
                  </div>
                  <div className="section-label">
                    <h2>Все ученики</h2>
                    <span>{filtered.length} записей</span>
                  </div>
                  <div className="inset-list student-list">
                    <AnimatePresence initial={false}>
                      {filtered.map((student) => (
                        <motion.article
                          layout
                          key={student.id}
                          className="student-row"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <div className="student-top">
                            <span className="avatar">
                              <GraduationCap size={20} strokeWidth={1.5} />
                            </span>
                            <div className="student-info">
                              <h3>{student.name}</h3>
                              <span>
                                {student.group} · #{student.id}
                              </span>
                            </div>
                            <div className="student-fee">
                              <strong>{formatMoney(student.monthlyAmount)}</strong>
                              <small>в месяц</small>
                            </div>
                          </div>
                          <div className="student-row-bottom">
                            <a href={`tel:${student.phone.replace(/[^+\d]/g, '')}`}>
                              {student.phone}
                            </a>
                            <div className="student-actions">
                              <Tip label="История оплат">
                                <button
                                  className="icon-button"
                                  aria-label={`История оплат: ${student.name}`}
                                  onPointerEnter={() => {
                                    void prefetchHistory(student.id).catch(() => undefined);
                                  }}
                                  onFocus={() => {
                                    void prefetchHistory(student.id).catch(() => undefined);
                                  }}
                                  onPointerDown={() => {
                                    void prefetchHistory(student.id).catch(() => undefined);
                                  }}
                                  onClick={() => void openHistory(student)}
                                  disabled={openingHistory !== undefined}
                                  aria-busy={openingHistory === student.id}
                                >
                                  {openingHistory === student.id ? (
                                    <Spinner />
                                  ) : (
                                    <HistoryIcon size={17} />
                                  )}
                                </button>
                              </Tip>
                              <Tip label="Редактировать">
                                <button
                                  className="icon-button"
                                  aria-label={`Редактировать: ${student.name}`}
                                  onClick={() => showModal({ type: 'student', student })}
                                >
                                  <Pencil size={16} />
                                </button>
                              </Tip>
                              <Tip label="Удалить ученика">
                                <button
                                  className="icon-button danger-text"
                                  aria-label={`Удалить: ${student.name}`}
                                  onClick={() => showModal({ type: 'delete', student })}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </Tip>
                              <Tip label="Внести оплату">
                                <button
                                  className="icon-button pay-icon"
                                  aria-label={`Внести оплату: ${student.name}`}
                                  onClick={() =>
                                    showModal({ type: 'payment', studentId: student.id })
                                  }
                                >
                                  <ArrowDownLeft size={18} />
                                </button>
                              </Tip>
                            </div>
                          </div>
                        </motion.article>
                      ))}
                    </AnimatePresence>
                  </div>
                  {!filtered.length && (
                    <Empty
                      icon={<Users size={25} />}
                      title={query ? 'Никого не нашли' : 'Нет учеников'}
                      text={
                        query
                          ? 'Попробуйте другое имя, телефон или название группы.'
                          : 'Добавьте первого ученика и месячную стоимость обучения.'
                      }
                      action={
                        !query ? (
                          <button
                            className="button primary"
                            onClick={() => showModal({ type: 'student' })}
                          >
                            <Plus size={17} />
                            Добавить ученика
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </>
              )}
            </motion.section>
          </AnimatePresence>
        )}
      </main>
      <Sheet open={sheetOpen} title={modalTitle} description={modalDescription} onClose={close}>
        {modal?.type === 'payment' && (
          <PaymentForm students={students} initialId={modal.studentId} onSaved={saved} />
        )}
        {modal?.type === 'student' && <StudentForm student={modal.student} onSaved={saved} />}
        {modal?.type === 'history' && <History student={modal.student} />}
        {modal?.type === 'delete' && (
          <DeleteStudent student={modal.student} onSaved={saved} onCancel={close} />
        )}
      </Sheet>
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              className="toast"
              initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduced ? 0 : 8 }}
            >
              <span className="toast-check">
                <Check size={16} />
              </span>
              {toast.text}
              <button
                className="icon-button"
                aria-label="Закрыть уведомление"
                onClick={() => setToast(undefined)}
              >
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
