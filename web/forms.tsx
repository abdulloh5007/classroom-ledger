import { useEffect, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react';
import { ArrowDownLeft, Check, Trash2 } from 'lucide-react';
import { paymentSchema, studentSchema, type Student } from '../src/contracts';
import { today, formatMoney } from '../src/calendar';
import { api, ApiError } from './api';
import { AmountField, Spinner, StudentSelect } from './components';
import { invalidateHistory, prefetchHistory, useHistory } from './history';

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
  const [studentId, setStudentId] = useState(initialId ? String(initialId) : '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = paymentSchema.safeParse({ amount: Number(amount), date });
    if (!parsed.success || !studentId) {
      setErrors({
        ...(!parsed.success ? parsed.error.flatten().fieldErrors : {}),
        ...(!studentId ? { studentId: ['Выберите ученика'] } : {}),
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
      onSaved('Оплата успешно внесена');
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
        <div className="field">
          <StudentSelect
            value={studentId}
            onChange={(value) => {
              setStudentId(value);
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
          label="Сумма оплаты"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            clearField(setErrors, 'amount');
            clearField(setErrors, 'monthlyAmount');
          }}
          error={errors.amount?.[0]}
        />
        <label className="field" htmlFor="payment-date">
          <span>Дата оплаты</span>
          <input
            id="payment-date"
            type="date"
            value={date}
            min="1900-01-01"
            max="9999-11-30"
            onChange={(event) => {
              setDate(event.target.value);
              clearField(setErrors, 'date');
            }}
            required
            aria-invalid={Boolean(errors.date)}
            aria-describedby={errors.date ? 'date-error' : undefined}
          />
          {errors.date && (
            <span className="field-error" id="date-error">
              {errors.date[0]}
            </span>
          )}
        </label>
        <p className="form-hint">Оплата попадёт в месяц указанной даты.</p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary full" disabled={busy || !students.length}>
          {busy ? <Spinner /> : <Check size={18} />}
          {busy ? 'Сохраняем…' : 'Сохранить оплату'}
        </button>
      </fieldset>
    </form>
  );
}
export function StudentForm({
  student,
  onSaved,
}: {
  student?: Student;
  onSaved: (text: string) => void;
}) {
  const [name, setName] = useState(student?.name ?? '');
  const [phone, setPhone] = useState(student?.phone ?? '');
  const [group, setGroup] = useState(student?.group ?? '');
  const [amount, setAmount] = useState(student ? String(student.monthlyAmount) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = studentSchema.safeParse({ name, phone, group, monthlyAmount: Number(amount) });
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors);
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api(student ? `/students/${student.id}` : '/students', {
        method: student ? 'PATCH' : 'POST',
        body: JSON.stringify(result.data),
      });
      onSaved(student ? 'Данные ученика обновлены' : 'Ученик добавлен');
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
              label: 'Имя и фамилия',
              value: name,
              set: setName,
              type: 'text',
              placeholder: 'Например, Азиза Каримова',
              autoComplete: 'name',
            },
            {
              key: 'phone',
              label: 'Телефон',
              value: phone,
              set: setPhone,
              type: 'tel',
              placeholder: '+998 90 123 45 67',
              autoComplete: 'tel',
            },
            {
              key: 'group',
              label: 'Группа',
              value: group,
              set: setGroup,
              type: 'text',
              placeholder: 'Например, English · A2',
              autoComplete: 'off',
            },
          ] as const
        ).map((field) => (
          <label className="field" key={field.key} htmlFor={`student-${field.key}`}>
            <span>{field.label}</span>
            <input
              id={`student-${field.key}`}
              value={field.value}
              type={field.type}
              autoComplete={field.autoComplete}
              maxLength={field.key === 'name' ? 100 : field.key === 'phone' ? 30 : 80}
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
                {errors[field.key]?.[0]}
              </span>
            )}
          </label>
        ))}
        <AmountField
          id="monthly-amount"
          label="Оплата в месяц"
          value={amount}
          onChange={(value) => {
            setAmount(value);
            clearField(setErrors, 'amount');
            clearField(setErrors, 'monthlyAmount');
          }}
          error={errors.monthlyAmount?.[0]}
        />
        {student && (
          <p className="form-hint">
            Новая месячная сумма применяется и при просмотре прошлых месяцев.
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={busy}>
          {busy ? <Spinner /> : <Check size={18} />}
          {busy ? 'Сохраняем…' : student ? 'Сохранить изменения' : 'Добавить ученика'}
        </button>
      </fieldset>
    </form>
  );
}
export function History({ student }: { student: Student }) {
  const history = useHistory(student.id);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void prefetchHistory(student.id).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : 'Не удалось загрузить оплаты');
    });
    return () => {
      active = false;
    };
  }, [student.id, attempt]);
  if (error && !history)
    return (
      <div className="error-message" role="alert">
        {error}
        <button className="button secondary full" onClick={() => setAttempt((value) => value + 1)}>
          Повторить
        </button>
      </div>
    );
  if (!history)
    return (
      <div className="loading-inline" role="status">
        <Spinner /> Загружаем историю…
      </div>
    );
  return (
    <>
      <div className="history-total">
        <span>Всего внесено за всё время</span>
        <strong>{formatMoney(history.totalAmount)}</strong>
      </div>
      <div className="inset-list">
        {history.items.map((payment) => (
          <div className="history-row" key={payment.id}>
            <span className="history-icon">
              <ArrowDownLeft size={18} />
            </span>
            <div>
              <strong>{formatMoney(payment.amount)}</strong>
              <small>Оплата #{payment.id}</small>
            </div>
            <time dateTime={payment.date}>{payment.date.split('-').reverse().join('.')}</time>
          </div>
        ))}
      </div>
      <p className="form-hint">
        Показано {history.items.length} из {history.total} оплат
      </p>
      {(history.error || error) && (
        <p className="error-message" role="alert">
          {history.error || error}
        </p>
      )}
      {history.nextCursor && (
        <button
          className="button secondary full"
          disabled={history.loadingMore}
          onClick={() => {
            setError('');
            void prefetchHistory(student.id, true).catch((error: unknown) =>
              setError(error instanceof Error ? error.message : 'Не удалось загрузить оплаты'),
            );
          }}
        >
          {history.loadingMore && <Spinner />}
          {history.loadingMore ? 'Загружаем…' : 'Показать ещё 10'}
        </button>
      )}
      {!history.items.length && (
        <p className="form-hint">Платежей пока нет. Внесите первую оплату в карточке ученика.</p>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/students/${student.id}`, { method: 'DELETE' });
      invalidateHistory(student.id);
      onSaved('Ученик удалён');
    } catch (error) {
      setError(fields(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <p>
        Ученик <b>{student.name}</b> и вся его история оплат будут удалены. Восстановить данные не
        получится.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <button className="button destructive full" onClick={() => void remove()} disabled={busy}>
        {busy ? <Spinner /> : <Trash2 size={18} />}
        {busy ? 'Удаляем…' : 'Удалить ученика'}
      </button>
      <button className="button secondary full" onClick={onCancel} disabled={busy}>
        Отмена
      </button>
    </div>
  );
}
