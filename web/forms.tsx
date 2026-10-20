import { groupCaption } from './labels';
import { moneyInput, parseMoneyInput } from '../src/money';
import { useI18n } from './i18n';
import { useEffect, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react';
import { ArrowDownLeft, Check, Trash2 } from 'lucide-react';
import { paymentSchema, studentEnrollmentSchema, type Student, type Group } from '../src/contracts';
import { today } from '../src/calendar';
import { api, ApiError } from './api';
import { AmountField, Spinner, StudentSelect } from './components';
import { invalidateHistory, prefetchHistory, useHistory } from './history';
import { PhoneField } from './PhoneField';
import { formatUzPhone, uzPhoneDigits } from '../src/phone';
import { MonthPicker } from './MonthPicker';

function clearField(setErrors: Dispatch<SetStateAction<Record<string, string[]>>>, key: string) {
  setErrors((previous) => {
    const next = { ...previous };
    delete next[key];
    return next;
  });
}

function fields(error: unknown): { message: string; fields: Record<string, string[]> } {
  return error instanceof ApiError
    ? { message: error.message, fields: error.fields }
    : { message: 'Не удалось сохранить. Повторите попытку.', fields: {} };
}
export function PaymentForm({
  students,
  initialId,
  onSaved,
}: {
  students: Student[];
  initialId?: number;
  onSaved: (text: string) => void;
}) {
  const { t, formatMoney } = useI18n();

  const [studentId, setStudentId] = useState(initialId ? String(initialId) : '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [balance, setBalance] = useState<{ key: string; paid: number; debt: number }>();
  const [balanceError, setBalanceError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const month = date.slice(0, 7);
  const balanceKey = `${studentId}/${month}`;
  const currentBalance = balance?.key === balanceKey ? balance : undefined;
  useEffect(() => {
    if (!studentId) return;
    const controller = new AbortController();
    setBalanceError('');
    setBalance(undefined);
    void api<{ paid: number; debt: number }>(`/students/${studentId}/balance?month=${month}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setBalance({ ...value, key: `${studentId}/${month}` });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setBalanceError(
            error instanceof Error ? error.message : t('Не удалось загрузить остаток'),
          );
      });
    return () => controller.abort();
  }, [studentId, month, attempt, t]);
  const currency = students.find((student) => String(student.id) === studentId)?.currency ?? 'UZS';
  const numericAmount = parseMoneyInput(amount, currency) ?? 0;
  const projectedPaid = (currentBalance?.paid ?? 0) + numericAmount;
  const projectedDebt = Math.max(0, (currentBalance?.debt ?? 0) - numericAmount);
  const percentage = currentBalance
    ? Math.min(
        100,
        Math.round((projectedPaid / Math.max(1, currentBalance.paid + currentBalance.debt)) * 100),
      )
    : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!currentBalance || numericAmount > currentBalance.debt) {
      setErrors({
        amount: [
          currentBalance
            ? t('Сумма оплаты превышает остаток долга')
            : t('Дождитесь загрузки остатка'),
        ],
      });
      return;
    }
    const parsed = paymentSchema.safeParse({ amount: parseMoneyInput(amount, currency), date });
    if (!parsed.success || !studentId) {
      setErrors({
        ...(!parsed.success ? parsed.error.flatten().fieldErrors : {}),
        ...(!studentId ? { studentId: [t('Выберите ученика')] } : {}),
      });
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api(`/students/${studentId}/payments`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      invalidateHistory(Number(studentId));
      onSaved(t('Оплата успешно внесена'));
    } catch (error) {
      const data = fields(error);
      setError(data.message);
      setErrors(data.fields);
      setAttempt((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form" noValidate aria-busy={busy}>
      <fieldset disabled={busy}>
        <div className="field">
          <StudentSelect
            value={studentId}
            onChange={(value) => {
              setStudentId(value);
              setAmount('');
              clearField(setErrors, 'studentId');
            }}
            disabled={busy}
            options={students.map((student) => ({
              value: String(student.id),
              label: `${student.name} · ${student.group}`,
            }))}
            error={errors.studentId?.[0]}
          />
        </div>
        <AmountField
          id="payment-amount"
          currency={currency}
          label={t('Сумма оплаты')}
          value={amount}
          max={currentBalance?.debt}
          disabled={!currentBalance}
          onMax={() => {
            if (currentBalance) {
              setAmount(moneyInput(currentBalance.debt, currency));
              clearField(setErrors, 'amount');
            }
          }}
          onChange={(value) => {
            if (currentBalance && (parseMoneyInput(value, currency) ?? 0) > currentBalance.debt) {
              setErrors((previous) => ({
                ...previous,
                amount: [t('Сумма оплаты превышает остаток долга')],
              }));
              return;
            }
            setAmount(value);
            clearField(setErrors, 'amount');
          }}
          error={errors.amount?.[0]}
        />
        <div className="field">
          <label htmlFor="payment-date">{t('Дата оплаты')}</label>
          <MonthPicker
            id="payment-date"
            className="payment-month"
            month={month}
            direction={1}
            date={date}
            onChange={() => undefined}
            onDateChange={(next) => {
              if (next.slice(0, 7) !== month) setAmount('');
              setDate(next);
              clearField(setErrors, 'date');
            }}
          />
          {errors.date && <span className="field-error">{t(errors.date[0]!)}</span>}
        </div>
        {currentBalance ? (
          <div className="payment-balance" aria-live="polite">
            <div className="payment-figures">
              <div>
                <span>{t(numericAmount > 0 ? 'После оплаты' : 'Оплачено')}</span>
                <strong>{formatMoney(projectedPaid, currency)}</strong>
              </div>
              <div>
                <span>{t(numericAmount > 0 ? 'Останется' : 'Осталось')}</span>
                <strong>{formatMoney(projectedDebt, currency)}</strong>
              </div>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label={t('Оплата за месяц')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <span style={{ width: `${percentage}%` }} />
            </div>
          </div>
        ) : studentId && !balanceError ? (
          <div className="payment-balance-loading" role="status">
            <Spinner />
            {t('Загружаем остаток…')}
          </div>
        ) : null}
        {balanceError && (
          <div className="error-message" role="alert">
            {t(balanceError)}
            <button
              type="button"
              className="button secondary full"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t('Повторить')}
            </button>
          </div>
        )}
        {error && (
          <p className="error-message" role="alert">
            {t(error)}
          </p>
        )}
        <button
          type="submit"
          className="button primary full"
          disabled={
            busy ||
            !students.length ||
            !currentBalance ||
            currentBalance.debt === 0 ||
            !amount ||
            numericAmount > currentBalance.debt
          }
        >
          {busy ? <Spinner /> : <Check size={18} />}
          {busy ? t('Сохраняем…') : t('Сохранить оплату')}
        </button>
      </fieldset>
    </form>
  );
}
export function StudentForm({
  student,
  groups,
  initialGroupId,
  onCreateGroup,
  onSaved,
}: {
  groups: Group[];
  initialGroupId?: number;
  onCreateGroup: () => void;
  student?: Student;
  onSaved: (text: string, groupId?: number) => void;
}) {
  const { t } = useI18n();

  const [name, setName] = useState(student?.name ?? '');
  const [phone, setPhone] = useState(formatUzPhone(student?.phone ?? ''));
  const [groupId, setGroupId] = useState(String(student?.groupId ?? initialGroupId ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = studentEnrollmentSchema.safeParse({ name, phone, groupId: Number(groupId) });
    if (uzPhoneDigits(phone).length !== 9) {
      setErrors({
        ...(!result.success ? result.error.flatten().fieldErrors : {}),
        phone: [t('Введите номер полностью: +998 (90) 123-56-78')],
      });
      return;
    }
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors);
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const updated = await api<Student>(student ? `/students/${student.id}` : '/students', {
        method: student ? 'PATCH' : 'POST',
        body: JSON.stringify(result.data),
      });
      onSaved(student ? t('Данные ученика обновлены') : t('Ученик добавлен'), updated.groupId);
    } catch (error) {
      const data = fields(error);
      setError(data.message);
      setErrors(data.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form" noValidate aria-busy={busy}>
      <fieldset disabled={busy}>
        {(
          [
            {
              key: 'name',
              label: t('Имя и фамилия'),
              value: name,
              set: setName,
              type: 'text',
              placeholder: t('Например, Азиза Каримова'),
              autoComplete: 'name',
            },
          ] as const
        ).map((field) => (
          <label className="field" key={field.key} htmlFor={`student-${field.key}`}>
            <span id={`student-${field.key}-label`}>{t(field.label)}</span>
            <input
              id={`student-${field.key}`}
              aria-labelledby={`student-${field.key}-label`}
              value={field.value}
              type={field.type}
              autoComplete={field.autoComplete}
              maxLength={100}
              onChange={(event) => {
                field.set(event.target.value);
                clearField(setErrors, field.key);
              }}
              placeholder={field.placeholder}
              required
              aria-invalid={Boolean(errors[field.key])}
              aria-describedby={errors[field.key] ? `${field.key}-error` : undefined}
            />
            {errors[field.key] && (
              <span id={`${field.key}-error`} className="field-error">
                {t(errors[field.key]?.[0] ?? '')}
              </span>
            )}
          </label>
        ))}
        <PhoneField
          value={phone}
          onChange={(value) => {
            setPhone(value);
            clearField(setErrors, 'phone');
          }}
          error={errors.phone?.[0]}
        />
        <div className="field">
          <StudentSelect
            id="enrollment-group"
            label={t('Группа')}
            placeholder={t('Выберите группу')}
            value={groupId}
            onChange={(value) => {
              setGroupId(value);
              clearField(setErrors, 'groupId');
            }}
            options={groups.map((group) => ({
              value: String(group.id),
              label: groupCaption(group.name, group.courseName),
            }))}
            error={errors.groupId?.[0]}
          />
        </div>
        {!groups.length && (
          <button className="button secondary full" type="button" onClick={onCreateGroup}>
            {t('Создать группу')}
          </button>
        )}
        {error && (
          <p className="error-message" role="alert">
            {t(error)}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={busy || !groups.length}>
          {busy ? <Spinner /> : <Check size={18} />}
          {busy ? t('Сохраняем…') : student ? t('Сохранить изменения') : t('Добавить ученика')}
        </button>
      </fieldset>
    </form>
  );
}
export function History({ student }: { student: Student }) {
  const { t, formatMoney } = useI18n();

  const history = useHistory(student.id);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void prefetchHistory(student.id).catch((error: unknown) => {
      if (active)
        setError(error instanceof Error ? error.message : t('Не удалось загрузить оплаты'));
    });
    return () => {
      active = false;
    };
  }, [student.id, attempt, t]);
  if (error && !history)
    return (
      <div className="error-message" role="alert">
        {t(error)}
        <button className="button secondary full" onClick={() => setAttempt((value) => value + 1)}>
          {t('Повторить')}{' '}
        </button>
      </div>
    );
  if (!history)
    return (
      <div className="loading-inline" role="status">
        <Spinner /> {t('Загружаем историю…')}{' '}
      </div>
    );
  return (
    <>
      <div className="history-total">
        <span>{t('Всего внесено за всё время')}</span>
        <strong>{formatMoney(history.totalAmount, student.currency)}</strong>
      </div>
      <div className="inset-list">
        {history.items.map((payment) => (
          <div className="history-row" key={payment.id}>
            <span className="history-icon">
              <ArrowDownLeft size={18} />
            </span>
            <div>
              <strong>{formatMoney(payment.amount, student.currency)}</strong>
              <small>
                {t('Оплата #')}
                {payment.id}
              </small>
            </div>
            <time dateTime={payment.date}>{payment.date.split('-').reverse().join('.')}</time>
          </div>
        ))}
      </div>
      <p className="form-hint">
        {t('Показано')} {history.items.length} {t('из')} {history.total} {t('оплат')}{' '}
      </p>
      {(history.error || error) && (
        <p className="error-message" role="alert">
          {t(history.error || error)}
        </p>
      )}
      {history.nextCursor && (
        <button
          className="button secondary full"
          disabled={history.loadingMore}
          onClick={() => {
            setError('');
            void prefetchHistory(student.id, true).catch((error: unknown) =>
              setError(error instanceof Error ? error.message : t('Не удалось загрузить оплаты')),
            );
          }}
        >
          {history.loadingMore && <Spinner />}
          {history.loadingMore ? t('Загружаем…') : t('Показать ещё 10')}
        </button>
      )}
      {!history.items.length && (
        <p className="form-hint">
          {t('Платежей пока нет. Внесите первую оплату в карточке ученика.')}
        </p>
      )}
    </>
  );
}
export function DeleteStudent({
  student,
  onSaved,
  onCancel,
}: {
  student: Student;
  onSaved: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/students/${student.id}`, { method: 'DELETE' });
      invalidateHistory(student.id);
      onSaved(t('Ученик удалён'));
    } catch (error) {
      setError(fields(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <p>
        {t('Ученик')} <b>{student.name}</b>{' '}
        {t('и вся его история оплат будут удалены. Восстановить данные не получится.')}{' '}
      </p>
      {error && (
        <p role="alert" className="error-message">
          {t(error)}
        </p>
      )}
      <button className="button destructive full" onClick={() => void remove()} disabled={busy}>
        {busy ? <Spinner /> : <Trash2 size={18} />}
        {busy ? t('Удаляем…') : t('Удалить ученика')}
      </button>
      <button className="button secondary full" onClick={onCancel} disabled={busy}>
        {t('Отмена')}{' '}
      </button>
    </div>
  );
}
