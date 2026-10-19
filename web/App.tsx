import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CircleCheck,
  CalendarDays,
  CreditCard,
  GraduationCap,
  History as HistoryIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { Student } from '../src/contracts';
import { currentMonth, formatMoney } from '../src/calendar';
import { Empty, Sheet, Tip, Spinner } from './components';
import { DeleteStudent, History, PaymentForm, StudentForm } from './forms';
import { prefetchHistory } from './history';
import { useLedger } from './useLedger';
import { WalletHero } from './WalletHero';
import { FloatingControls } from './FloatingControls';
import { PaymentFilter, type PaymentStatus } from './PaymentFilter';
import { revealTheme } from './theme';

type Modal =
  | { type: 'payment'; studentId?: number }
  | { type: 'student'; student?: Student }
  | { type: 'history' | 'delete'; student: Student };
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
function matchesStudent(student: Student, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru');
  const digits = needle.replace(/\D/g, '');
  return (
    `${student.name} ${student.phone} ${student.group}`.toLocaleLowerCase('ru').includes(needle) ||
    (digits.length >= 3 && student.phone.replace(/\D/g, '').includes(digits))
  );
}
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
  const {
    students,
    months,
    loading: monthLoading,
    ready,
    studentsError,
    monthError,
    reload,
  } = useLedger(month);
  const loading = !ready || (tab === 'debtors' && monthLoading);
  const error = studentsError || (tab === 'debtors' ? monthError : '');
  const future = month > currentMonth();
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const debtors = (future ? [] : (months[month] ?? [])).filter((row) =>
    paymentStatus === 'unpaid'
      ? row.paid === 0
      : paymentStatus === 'partial'
        ? row.paid > 0 && row.debt > 0
        : row.debt === 0,
  );
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
    const visible = students.filter((student) => matchesStudent(student, query)).slice(0, 10);
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
  function selectMonth(next: string) {
    setDirection(next < month ? -1 : 1);
    setMonth(next);
  }
  const filtered = students.filter((student) => matchesStudent(student, query));
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
    <div className="app-shell wallet-shell">
      <a className="skip-link" href="#content">
        Перейти к содержимому
      </a>
      <main id="content">
        <h1 className="sr-only">Учёт оплат</h1>
        <WalletHero
          month={month}
          direction={direction}
          months={months}
          totalStudents={students.length}
          ready={ready}
          onMonthChange={selectMonth}
          onLogout={onLogout}
          loggingOut={loggingOut}
        />
        <div className="wallet-tabs">
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
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="wallet-content">
          {error ? (
            <div className="network-error" role="alert">
              <p>{error}</p>
              <button className="button secondary" onClick={() => void reload()}>
                Попробовать снова
              </button>
            </div>
          ) : loading ? (
            <div className="skeletons" role="status" aria-label="Загрузка данных">
              <div className="skeleton card-skeleton" />
              <div className="skeleton card-skeleton" />
              <span className="sr-only">Загружаем учеников и оплаты</span>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.section
                key={tab === 'students' ? tab : `${tab}-${month}`}
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
                    {!future && students.length > 0 && (
                      <div className="section-label compact-label">
                        <h2>{paymentStatus === 'paid' ? 'Оплатили' : 'Ожидают оплаты'}</h2>
                        <PaymentFilter value={paymentStatus} onChange={setPaymentStatus} />
                      </div>
                    )}
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
                              aria-valuenow={Math.min(
                                100,
                                Math.round((debtor.paid / debtor.monthlyAmount) * 100),
                              )}
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
                        icon={future ? <CalendarDays size={25} /> : <CircleCheck size={25} />}
                        title={
                          future
                            ? 'Месяц ещё не начался'
                            : students.length
                              ? 'Нет учеников по фильтру'
                              : 'Нет учеников'
                        }
                        text={
                          future
                            ? 'Данные появятся, когда наступит этот месяц.'
                            : students.length
                              ? 'Выберите другой статус оплаты с помощью фильтра.'
                              : 'Добавьте первого ученика, чтобы начать учёт оплат.'
                        }
                        action={
                          !future && !students.length ? (
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
                                    disabled={future}
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
        </div>
      </main>
      <FloatingControls
        dark={dark}
        onTheme={(button) => void revealTheme(button, () => setTheme(dark ? 'light' : 'dark'))}
        hidden={sheetOpen}
      />
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
