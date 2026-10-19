import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { courseSchema, type Course } from '../src/contracts';
import { AmountField, Empty, Spinner, Tip } from './components';
import { api, ApiError } from './api';
import { useI18n } from './i18n';

export function Courses({
  courses,
  onCreate,
  onEdit,
  onDelete,
}: {
  courses: Course[];
  onCreate: () => void;
  onEdit: (course: Course) => void;
  onDelete: (course: Course) => void;
}) {
  const { t, formatMoney } = useI18n();
  return (
    <>
      <div className="section-label courses-toolbar">
        <h2>{t('Курсы')}</h2>
        <button className="button primary small" onClick={onCreate}>
          <Plus size={17} />
          {t('Добавить курс')}
        </button>
      </div>
      <div className="inset-list">
        <AnimatePresence initial={false}>
          {courses.map((course) => (
            <motion.article
              layout
              className="course-row"
              key={course.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <span className="avatar">
                <BookOpen size={19} />
              </span>
              <div className="student-info">
                <h3>{course.name}</h3>
                <span>
                  {formatMoney(course.monthlyAmount)} / {t('Месяц').toLocaleLowerCase()}
                </span>
                <small>
                  {t('Ученики')}: {course.studentCount}
                </small>
              </div>
              <div className="student-actions">
                <Tip label={t('Редактировать курс')}>
                  <button
                    className="icon-button"
                    aria-label={`${t('Редактировать курс')}: ${course.name}`}
                    onClick={() => onEdit(course)}
                  >
                    <Pencil size={16} />
                  </button>
                </Tip>
                <Tip
                  label={
                    course.studentCount
                      ? t('Нельзя удалить курс с учениками')
                      : course.groupCount
                        ? t('Нельзя удалить курс с группами')
                        : t('Удалить курс')
                  }
                >
                  <button
                    className="icon-button danger-text"
                    aria-label={`${t('Удалить курс')}: ${course.name}`}
                    aria-disabled={course.studentCount > 0 || course.groupCount > 0}
                    onClick={() => {
                      if (!course.studentCount && !course.groupCount) onDelete(course);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </Tip>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
      {!courses.length && (
        <Empty
          icon={<BookOpen size={25} />}
          title={t('Нет курсов')}
          text={t('Сначала создайте курс, затем добавьте в него ученика.')}
        />
      )}
    </>
  );
}
export function CourseForm({
  course,
  onSaved,
}: {
  course?: Course;
  onSaved: (text: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(course?.name ?? '');
  const [amount, setAmount] = useState(course ? String(course.monthlyAmount) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = courseSchema.safeParse({ name, monthlyAmount: Number(amount) });
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
        <AmountField
          id="course-amount"
          label={t('Оплата в месяц')}
          value={amount}
          onChange={(value) => {
            setAmount(value);
            setErrors({});
          }}
          error={errors.monthlyAmount?.[0]}
        />
        {course && (
          <p className="form-hint">
            {t('Изменение курса обновит стоимость всех его учеников, включая прошлые месяцы.')}
          </p>
        )}
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
export function DeleteCourse({
  course,
  onSaved,
  onCancel,
}: {
  course: Course;
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
      await api(`/courses/${course.id}`, { method: 'DELETE' });
      onSaved(t('Курс удалён'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <p>{course.name}</p>
      {error && (
        <p className="error-message" role="alert">
          {t(error)}
        </p>
      )}
      <button className="button destructive full" onClick={() => void remove()} disabled={busy}>
        {busy ? <Spinner /> : <Trash2 size={18} />}
        {t(busy ? 'Удаляем…' : 'Удалить курс')}
      </button>
      <button className="button secondary full" onClick={onCancel} disabled={busy}>
        {t('Отмена')}
      </button>
    </div>
  );
}
