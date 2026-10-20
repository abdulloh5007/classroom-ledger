import { moneyInput, parseMoneyInput } from '../src/money';
import { useState, type FormEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { groupPatchSchema, groupSchema, type Course, type Group } from '../src/contracts';
import { api, ApiError } from './api';
import { AmountField, ConfirmDelete, Spinner, StudentSelect, Tip } from './components';
import { useI18n } from './i18n';

export type GroupDraft = { name: string; courseId: string };

export function GroupForm({
  draft,
  onDraftChange,
  courses,
  onCreated,
  onCreateCourse,
}: {
  draft: GroupDraft;
  onDraftChange: (draft: GroupDraft) => void;
  courses: Course[];
  onCreated: (group: Group) => void;
  onCreateCourse: () => void;
}) {
  const { t, formatMoney } = useI18n();
  const { name, courseId } = draft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = groupSchema.safeParse({ name, courseId: Number(courseId) });
    if (!parsed.success) {
      setErrors({
        ...parsed.error.flatten().fieldErrors,
        ...(!courseId ? { courseId: ['Выберите курс'] } : {}),
      });
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      onCreated(await api<Group>('/groups', { method: 'POST', body: JSON.stringify(parsed.data) }));
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
        <label className="field" htmlFor="group-name">
          <span id="group-name-label">{t('Название группы')}</span>
          <input
            id="group-name"
            autoFocus
            aria-labelledby="group-name-label"
            value={name}
            maxLength={80}
            required
            autoComplete="off"
            onChange={(event) => {
              onDraftChange({ ...draft, name: event.target.value });
              setErrors((previous) => ({ ...previous, name: [] }));
            }}
            aria-invalid={Boolean(errors.name?.length)}
            aria-describedby={errors.name?.length ? 'group-name-error' : undefined}
          />
          {errors.name?.[0] && (
            <span className="field-error" id="group-name-error">
              {t(errors.name[0])}
            </span>
          )}
        </label>
        <div className="field">
          <StudentSelect
            id="group-course"
            label={t('Курс')}
            placeholder={t('Выберите курс')}
            value={courseId}
            onChange={(value) => {
              onDraftChange({ ...draft, courseId: value });
              setErrors((previous) => ({ ...previous, courseId: [] }));
            }}
            options={courses.map((course) => ({
              value: String(course.id),
              label: `${course.name} · ${formatMoney(course.monthlyAmount, course.currency)}`,
            }))}
            error={errors.courseId?.[0]}
          />
        </div>
        {error && (
          <p className="error-message" role="alert">
            {t(error)}
          </p>
        )}
        <div className="form-actions">
          <button className="button primary" type="submit" disabled={busy || !courses.length}>
            {busy ? <Spinner /> : <Check size={18} />}
            {t(busy ? 'Сохраняем…' : 'Создать группу')}
          </button>
          <button
            className="button secondary round-action"
            type="button"
            onClick={onCreateCourse}
            aria-label={t('Добавить курс')}
          >
            <Plus size={20} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function GroupEditor({
  group,
  onSaved,
  onDeleted,
}: {
  group: Group;
  onSaved: (text: string) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(group.name);
  const [amount, setAmount] = useState(moneyInput(group.monthlyAmount, group.currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirm, setConfirm] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = groupPatchSchema.safeParse({
      name,
      monthlyAmount: parseMoneyInput(amount, group.currency),
    });
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await api(`/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify(parsed.data) });
      onSaved(t('Группа обновлена'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить. Повторите попытку.');
      if (error instanceof ApiError) setErrors(error.fields);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/groups/${group.id}`, { method: 'DELETE' });
      setConfirm(false);
      onDeleted();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="form" onSubmit={submit} noValidate aria-busy={busy}>
        <fieldset disabled={busy}>
          <label className="field" htmlFor="edit-group-name">
            <span>{t('Название группы')}</span>
            <input
              id="edit-group-name"
              value={name}
              maxLength={80}
              required
              onChange={(event) => {
                setName(event.target.value);
                setErrors({});
              }}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'edit-group-name-error' : undefined}
            />
            {errors.name && (
              <span className="field-error" id="edit-group-name-error">
                {t(errors.name[0]!)}
              </span>
            )}
          </label>
          <label className="field" htmlFor="edit-course-name">
            <span>{t('Название курса')}</span>
            <input id="edit-course-name" value={group.courseName} readOnly />
          </label>
          <AmountField
            id="edit-group-amount"
            label={t('Оплата в месяц')}
            hint={`${t('Новая стоимость действует со следующего месяца. История и тарифы прошлых месяцев сохраняются.')} ${t('Изменения курса применяются ко всем его группам.')}`}
            value={amount}
            currency={group.currency}
            onChange={(value) => {
              setAmount(value);
              setErrors({});
            }}
            error={errors.monthlyAmount?.[0]}
          />
          {error && !confirm && (
            <p className="error-message" role="alert">
              {t(error)}
            </p>
          )}
          <div className="form-actions">
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? <Spinner /> : <Check size={18} />}
              {t('Сохранить изменения')}
            </button>
            <Tip label={t('Удалить группу')}>
              <button
                className="button secondary round-action danger-text"
                type="button"
                aria-label={t('Удалить группу')}
                disabled={busy}
                onClick={() => {
                  setError('');
                  setConfirm(true);
                }}
              >
                <Trash2 size={18} />
              </button>
            </Tip>
          </div>
        </fieldset>
      </form>
      <ConfirmDelete
        open={confirm}
        busy={busy}
        error={error}
        description={t('Группа, её ученики и оплаты будут удалены. Другие группы сохранятся.')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
