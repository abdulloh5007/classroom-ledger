import { useState, type FormEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { groupSchema, type Course, type Group } from '../src/contracts';
import { api, ApiError } from './api';
import { Spinner, StudentSelect } from './components';
import { useI18n } from './i18n';

export function GroupForm({
  courses,
  onCreated,
  onCreateCourse,
}: {
  courses: Course[];
  onCreated: (group: Group) => void;
  onCreateCourse: () => void;
}) {
  const { t, formatMoney } = useI18n();
  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState('');
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
            aria-labelledby="group-name-label"
            value={name}
            maxLength={80}
            required
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
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
              setCourseId(value);
              setErrors((previous) => ({ ...previous, courseId: [] }));
            }}
            options={courses.map((course) => ({
              value: String(course.id),
              label: `${course.name} · ${formatMoney(course.monthlyAmount, course.currency)}`,
            }))}
            error={errors.courseId?.[0]}
          />
        </div>
        <p className="form-hint">{t('Все ученики группы учатся на одном курсе.')}</p>
        {!courses.length && (
          <button className="button secondary full" type="button" onClick={onCreateCourse}>
            <Plus size={17} />
            {t('Добавить курс')}
          </button>
        )}
        {error && (
          <p className="error-message" role="alert">
            {t(error)}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={busy || !courses.length}>
          {busy ? <Spinner /> : <Check size={18} />}
          {t(busy ? 'Сохраняем…' : 'Создать группу')}
        </button>
      </fieldset>
    </form>
  );
}
