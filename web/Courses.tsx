import { moneyInput, parseMoneyInput } from '../src/money';
import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { courseSchema, type Course, type Currency } from '../src/contracts';
import { AmountField, Spinner, StudentSelect } from './components';
import { api, ApiError } from './api';
import { useI18n } from './i18n';

export function CourseForm({
  course,
  onSaved,
}: {
  course?: Course;
  onSaved: (text: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(course?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(course?.currency ?? 'UZS');
  const [amount, setAmount] = useState(
    course ? moneyInput(course.monthlyAmount, course.currency) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = courseSchema.safeParse({
      name,
      currency,
      monthlyAmount: parseMoneyInput(amount, currency),
    });
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api(course ? `/courses/${course.id}` : '/courses', {
        method: course ? 'PATCH' : 'POST',
        body: JSON.stringify(parsed.data),
      });
      onSaved(t(course ? 'Курс обновлён' : 'Курс добавлен'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить. Повторите попытку.');
      if (error instanceof ApiError) setErrors(error.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset disabled={busy}>
        <label className="field" htmlFor="course-name">
          <span>{t('Название курса')}</span>
          <input
            id="course-name"
            value={name}
            maxLength={80}
            required
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setErrors({});
            }}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'course-name-error' : undefined}
          />
          {errors.name && (
            <span id="course-name-error" className="field-error">
              {t(errors.name[0]!)}
            </span>
          )}
        </label>
        <div className="field">
          <StudentSelect
            id="course-currency"
            label={t('Валюта курса')}
            value={currency}
            disabled={Boolean(course?.studentCount)}
            onChange={(value) => {
              setCurrency(value as Currency);
              setAmount('');
              setErrors({});
            }}
            options={[
              { value: 'UZS', label: `UZS · ${t('сум')}` },
              { value: 'USD', label: 'USD · $' },
            ]}
            error={errors.currency?.[0]}
          />
        </div>
        <AmountField
          currency={currency}
          id="course-amount"
          label={t('Оплата в месяц')}
          hint={
            course
              ? t(
                  'Новая стоимость действует со следующего месяца. История и тарифы прошлых месяцев сохраняются.',
                )
              : undefined
          }
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setErrors({});
          }}
          error={errors.monthlyAmount?.[0]}
        />
        {error && (
          <p className="error-message" role="alert">
            {t(error)}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={busy}>
          {busy ? <Spinner /> : <Check size={18} />}
          {t(busy ? 'Сохраняем…' : course ? 'Сохранить изменения' : 'Добавить курс')}
        </button>
      </fieldset>
    </form>
  );
}
