import { Marquee } from './Marquee';
import { useI18n } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
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
import type { Course, Group, Student } from '../src/contracts';
import { currentMonth } from '../src/calendar';
import { Empty, Sheet, Tip, Spinner } from './components';
import { DeleteStudent, History, PaymentForm, StudentForm } from './forms';
import { prefetchHistory } from './history';
import { useLedger } from './useLedger';
import { WalletHero } from './WalletHero';
import { FloatingControls } from './FloatingControls';
import { PaymentFilter, type PaymentStatus } from './PaymentFilter';
import { revealTheme } from './theme';
import { CourseForm } from './Courses';
import { GroupForm, GroupEditor, type GroupDraft } from './Groups';

type Modal =
  | { type: 'payment'; studentId?: number }
  | { type: 'student'; student?: Student }
  | { type: 'history' | 'delete'; student: Student }
  | { type: 'course'; course?: Course }
  | { type: 'editGroup'; group: Group }
  | { type: 'group' };
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
  loggingOut = false,
}: {
  onLogout?: () => Promise<void>;
  loggingOut?: boolean;
}) {
  const { t, formatMoney } = useI18n();

  const [month, setMonth] = useState(currentMonth());
  const [direction, setDirection] = useState(1);
  const [tab, setTab] = useState<'debtors' | 'students'>('debtors');
  const {
    students,
    groups,
    group,
    selectGroup,
    registerGroup,
    registerCourse,
    courses,
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
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('all');
  const debtors = (future ? [] : (months[month] ?? [])).filter((row) =>
    paymentStatus === 'all'
      ? true
      : paymentStatus === 'unpaid'
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
  const showModal = useCallback((value: Modal) => {
    historyRequest.current++;
    setOpeningHistory(undefined);
    setModal(value);
    setSheetOpen(true);
  }, []);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>({ name: '', courseId: '' });
  const createGroup = useCallback(() => {
    setGroupDraft({ name: '', courseId: '' });
    showModal({ type: 'group' });
  }, [showModal]);
  const editGroup = useCallback(() => {
    if (group) showModal({ type: 'editGroup', group });
  }, [group, showModal]);
  const changeGroup = useCallback(
    (id: number) => {
      selectGroup(id);
      setQuery('');
    },
    [selectGroup],
  );
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
  const selectMonth = useCallback(
    (next: string) => {
      setDirection(next < month ? -1 : 1);
      setMonth(next);
    },
    [month],
  );
  const filtered = students.filter((student) => matchesStudent(student, query));
  const modalTitle = !modal
    ? ''
    : modal.type === 'editGroup'
      ? t('Изменить группу')
      : modal.type === 'group'
        ? t('Создать группу')
        : modal.type === 'course'
          ? t(modal.course ? 'Редактировать курс' : 'Новый курс')
          : modal.type === 'payment'
            ? t('Внести оплату')
            : modal.type === 'student'
              ? modal.student
                ? t('Редактировать ученика')
                : t('Новый ученик')
              : modal.type === 'delete'
                ? t('Удалить ученика?')
                : t('История оплат');
  const modalDescription = !modal
    ? ''
    : modal.type === 'group' || modal.type === 'course' || modal.type === 'editGroup'
      ? ''
      : modal.type === 'payment'
        ? ''
        : modal.type === 'student'
          ? ''
          : modal.type === 'history'
            ? modal.student.name
            : t('Это действие нельзя отменить');
  return (
    <div className="app-shell wallet-shell" aria-busy={loggingOut || undefined}>
      <a className="skip-link" href="#content">
        {t('Перейти к содержимому')}{' '}
      </a>
      <main id="content">
        <h1 className="sr-only">{t('Учёт оплат')}</h1>
        <WalletHero
          month={month}
          direction={direction}
          months={months}
          totalStudents={students.length}
          ready={ready}
          onMonthChange={selectMonth}
          groupName={group?.name ?? ''}
          onCreateGroup={createGroup}
          onEditGroup={editGroup}
          onSelectGroup={changeGroup}
          groups={groups}
          groupId={group?.id}
          currency={group?.currency ?? 'UZS'}
        />
        <div className="wallet-tabs">
          <div className="segment-control" role="tablist" aria-label={t('Раздел учёта')}>
            {(
              [
                { id: 'debtors', label: t('Должники'), Icon: CreditCard },
                { id: 'students', label: t('Ученики'), Icon: Users },
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
                    const order = ['debtors', 'students'] as const;
                    const target =
                      event.key === 'Home'
                        ? order[0]
                        : event.key === 'End'
                          ? order[1]
                          : order[
                              (order.indexOf(tab) +
                                (event.key === 'ArrowRight' ? 1 : -1) +
                                order.length) %
                                order.length
                            ]!;
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
                  {t(label)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="wallet-content">
          {error ? (
            <div className="network-error" role="alert">
              <p>{t(error)}</p>
              <button className="button secondary" onClick={() => void reload()}>
                {t('Попробовать снова')}{' '}
              </button>
            </div>
          ) : loading ? (
            <div className="skeletons" role="status" aria-label={t('Загрузка данных')}>
              <div className="skeleton card-skeleton" />
              <div className="skeleton card-skeleton" />
              <span className="sr-only">{t('Загружаем учеников и оплаты')}</span>
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
                    <div className="section-label compact-label">
                      <h2>
                        {paymentStatus === 'all'
                          ? t('Оплаты за месяц')
                          : paymentStatus === 'paid'
                            ? t('Оплатили')
                            : t('Ожидают оплаты')}
                      </h2>
                      <PaymentFilter value={paymentStatus} onChange={setPaymentStatus} />
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
                                <Marquee text={`${debtor.group} • ${group?.courseName ?? ''}`} />
                              </div>
                              <span className="student-id">#{debtor.studentId}</span>
                            </div>
                            <div className="payment-figures">
                              <div>
                                <span>{t('Оплачено')}</span>
                                <strong>{formatMoney(debtor.paid, debtor.currency)}</strong>
                              </div>
                              <div>
                                <span>{t('Осталось')}</span>
                                <strong className="debt-figure">
                                  {formatMoney(debtor.debt, debtor.currency)}
                                </strong>
                              </div>
                            </div>
                            <div
                              className="progress"
                              role="progressbar"
                              aria-label={`${t('Оплата')} ${debtor.name}`}
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
                                disabled={debtor.debt === 0}
                                onClick={() =>
                                  showModal({ type: 'payment', studentId: debtor.studentId })
                                }
                              >
                                <Plus size={15} />
                                {t('Внести оплату')}{' '}
                              </button>
                            </div>
                          </motion.article>
                        ))}
                      </AnimatePresence>
                    </div>
                    {!debtors.length && (
                      <Empty
                        title={t(
                          !group
                            ? 'Нет групп'
                            : !students.length
                              ? 'Нет учеников'
                              : future
                                ? 'Месяц ещё не начался'
                                : 'Нет учеников по фильтру',
                        )}
                        action={
                          <button
                            className="button primary"
                            onClick={() => {
                              if (!group) createGroup();
                              else if (!students.length) showModal({ type: 'student' });
                              else if (future) selectMonth(currentMonth());
                              else setPaymentStatus('all');
                            }}
                          >
                            {t(
                              !group
                                ? 'Создать группу'
                                : !students.length
                                  ? 'Добавить ученика'
                                  : future
                                    ? 'Текущий месяц'
                                    : 'Показать всех',
                            )}
                          </button>
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
                          placeholder={t('Имя, группа или телефон')}
                          aria-label={t('Поиск учеников')}
                        />
                        {query && (
                          <button
                            className="icon-button"
                            onClick={() => setQuery('')}
                            aria-label={t('Очистить поиск')}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </label>
                      <Tip label={t('Добавить ученика')}>
                        <button
                          className="button primary add-student"
                          aria-label={t('Добавить ученика')}
                          onClick={() => (group ? showModal({ type: 'student' }) : createGroup())}
                        >
                          <Plus size={19} />
                          <span>{t('Добавить')}</span>
                        </button>
                      </Tip>
                    </div>
                    <div className="section-label">
                      <h2>{t('Все ученики')}</h2>
                      <span>
                        {filtered.length} {t('записей')}
                      </span>
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
                                <Marquee
                                  text={`${student.group} • ${group?.courseName ?? ''} · #${student.id}`}
                                />
                              </div>
                              <div className="student-fee">
                                <strong>
                                  {formatMoney(student.monthlyAmount, student.currency)}
                                </strong>
                                <small>{t('в месяц')}</small>
                              </div>
                            </div>
                            <div className="student-row-bottom">
                              <a href={`tel:${student.phone.replace(/[^+\d]/g, '')}`}>
                                {student.phone}
                              </a>
                              <div className="student-actions">
                                <Tip label={t('История оплат')}>
                                  <button
                                    className="icon-button"
                                    aria-label={`${t('История оплат')}: ${student.name}`}
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
                                <Tip label={t('Редактировать')}>
                                  <button
                                    className="icon-button"
                                    aria-label={`${t('Редактировать')}: ${student.name}`}
                                    onClick={() => showModal({ type: 'student', student })}
                                  >
                                    <Pencil size={16} />
                                  </button>
                                </Tip>
                                <Tip label={t('Удалить ученика')}>
                                  <button
                                    className="icon-button danger-text"
                                    aria-label={`${t('Удалить')}: ${student.name}`}
                                    onClick={() => showModal({ type: 'delete', student })}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </Tip>
                                <Tip label={t('Внести оплату')}>
                                  <button
                                    className="icon-button pay-icon"
                                    aria-label={`${t('Внести оплату')}: ${student.name}`}
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
                        title={t(
                          !group
                            ? 'Нет групп'
                            : students.length
                              ? 'Никого не нашли'
                              : 'Нет учеников',
                        )}
                        action={
                          <button
                            className="button primary"
                            onClick={() => {
                              if (students.length) setQuery('');
                              else if (group) showModal({ type: 'student' });
                              else createGroup();
                            }}
                          >
                            {t(
                              students.length
                                ? 'Очистить поиск'
                                : group
                                  ? 'Добавить ученика'
                                  : 'Создать группу',
                            )}
                          </button>
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
        {modal?.type === 'student' && (
          <StudentForm
            student={modal.student}
            groups={groups}
            initialGroupId={group?.id}
            onCreateGroup={createGroup}
            onSaved={(text, id) => {
              if (id) selectGroup(id);
              saved(text);
            }}
          />
        )}
        {modal?.type === 'group' && (
          <GroupForm
            draft={groupDraft}
            onDraftChange={setGroupDraft}
            courses={courses}
            onCreated={(created) => {
              registerGroup(created);
              setQuery('');
              saved(t('Группа создана'));
            }}
            onCreateCourse={() => showModal({ type: 'course' })}
          />
        )}
        {modal?.type === 'course' && (
          <CourseForm
            course={modal.course}
            onBack={() => showModal({ type: 'group' })}
            onSaved={(text, created) => {
              registerCourse(created);
              setGroupDraft((draft) => ({ ...draft, courseId: String(created.id) }));
              setToast({ id: Date.now(), text });
              showModal({ type: 'group' });
            }}
          />
        )}
        {modal?.type === 'editGroup' && (
          <GroupEditor
            group={modal.group}
            onSaved={saved}
            onDeleted={() => {
              selectGroup(groups.find((row) => row.id !== modal.group.id)?.id ?? 0);
              saved(t('Группа удалена'));
            }}
          />
        )}
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
                aria-label={t('Закрыть уведомление')}
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
