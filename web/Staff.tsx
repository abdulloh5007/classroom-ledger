import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Plus, Pencil } from 'lucide-react';
import type { StaffUser, Group } from '../src/contracts';
import { staffCreateSchema, staffPatchSchema } from '../src/contracts';
import { api } from './api';
import { Spinner, StudentSelect } from './components';
import { roleLabel, usePermissions } from './Session';

export function PasswordChange({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [repeat, setRepeat] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (newPassword !== repeat) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">
        После смены пароля войдите заново. Остальные сессии этого аккаунта будут отозваны.
      </p>
      <fieldset disabled={busy}>
        {[
          {
            label: 'Текущий пароль',
            value: currentPassword,
            set: setCurrent,
            auto: 'current-password',
          },
          { label: 'Новый пароль', value: newPassword, set: setNew, auto: 'new-password' },
          { label: 'Повторите новый пароль', value: repeat, set: setRepeat, auto: 'new-password' },
        ].map((field) => (
          <label className="field" key={field.label}>
            <span>{field.label}</span>
            <input
              type="password"
              autoComplete={field.auto}
              value={field.value}
              onChange={(event) => field.set(event.target.value)}
              minLength={field.auto === 'new-password' ? 8 : 1}
              maxLength={128}
              required
            />
          </label>
        ))}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? <Spinner /> : <Check size={18} />}Сменить пароль
        </button>
      </fieldset>
    </form>
  );
}

type AuditEvent = {
  id: number;
  action: string;
  actor: string | null;
  targetType: string;
  targetId: number | null;
  createdAt: string;
};
export function StaffPanel({ groups }: { groups: Group[] }) {
  const [users, setUsers] = useState<StaffUser[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<StaffUser | 'new'>(),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState<'staff' | 'audit'>('staff');
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError('');
    void api<StaffUser[]>('/staff', { signal: abort.signal })
      .then(setUsers)
      .catch((error) => {
        if (!abort.signal.aborted)
          setError(error instanceof Error ? error.message : 'Не удалось загрузить сотрудников');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);
  if (selected)
    return (
      <StaffForm
        user={selected === 'new' ? undefined : selected}
        groups={groups}
        onBack={() => setSelected(undefined)}
        onSaved={() => {
          setSelected(undefined);
          setRevision((value) => value + 1);
        }}
      />
    );
  return (
    <div className="staff-panel">
      <div className="staff-toolbar">
        <div className="staff-tabs" role="group" aria-label="Раздел сотрудников">
          <button
            className="button secondary"
            aria-pressed={tab === 'staff'}
            onClick={() => setTab('staff')}
          >
            Сотрудники
          </button>
          <button
            className="button secondary"
            aria-pressed={tab === 'audit'}
            onClick={() => setTab('audit')}
          >
            Журнал
          </button>
        </div>
        {tab === 'staff' && (
          <button
            className="icon-button"
            aria-label="Добавить сотрудника"
            onClick={() => setSelected('new')}
          >
            <Plus size={20} />
          </button>
        )}
      </div>
      {tab === 'audit' ? (
        <AuditList />
      ) : (
        <>
          {loading && (
            <div role="status">
              <Spinner /> Загружаем сотрудников…
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
              <button
                className="button secondary"
                onClick={() => setRevision((value) => value + 1)}
              >
                Повторить
              </button>
            </p>
          )}
          <div className="staff-list">
            {users.map((user) => (
              <article className="staff-row" key={user.id}>
                <div className="staff-copy">
                  <strong>{user.name}</strong>
                  <span>
                    {roleLabel[user.role]} · <code>{user.username}</code>
                  </span>
                  <small>
                    {!user.active
                      ? 'Доступ отключён'
                      : user.mustChangePassword
                        ? 'Нужна смена временного пароля'
                        : 'Доступ включён'}
                    {user.telegramId && (
                      <>
                        {' '}
                        · TG <code>{user.telegramId}</code>
                      </>
                    )}
                  </small>
                </div>
                {user.role !== 'owner' && (
                  <button
                    className="icon-button"
                    aria-label={'Изменить сотрудника ' + user.name}
                    onClick={() => setSelected(user)}
                  >
                    <Pencil size={18} />
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function StaffForm({
  user,
  groups,
  onBack,
  onSaved,
}: {
  user?: StaffUser;
  groups: Group[];
  onBack: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user?.name ?? ''),
    [username, setUsername] = useState(user?.username ?? ''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState<'teacher' | 'admin'>(user?.role === 'admin' ? 'admin' : 'teacher'),
    [telegramId, setTelegramId] = useState(user?.telegramId ? String(user.telegramId) : ''),
    [groupIds, setGroups] = useState(user?.groupIds ?? []),
    [active, setActive] = useState(user?.active ?? true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const values = {
      name,
      username,
      role,
      telegramId: telegramId ? Number(telegramId) : null,
      groupIds,
      ...(password ? { password } : {}),
      ...(user ? { active } : {}),
    };
    const result = (user ? staffPatchSchema : staffCreateSchema).safeParse(values);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Проверьте поля');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(user ? '/staff/' + user.id : '/staff', {
        method: user ? 'PATCH' : 'POST',
        body: JSON.stringify(result.data),
      });
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить сотрудника');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={submit}>
      <button className="button secondary" type="button" onClick={onBack}>
        <ArrowLeft size={18} />
        Назад
      </button>
      <fieldset disabled={busy}>
        <label className="field">
          <span>Имя сотрудника</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />
        </label>
        <label className="field">
          <span>Логин сотрудника</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={64}
            required
          />
        </label>
        <label className="field">
          <span id="staff-password-label">
            {user ? 'Новый временный пароль' : 'Временный пароль'}
          </span>
          <input
            type="password"
            aria-labelledby="staff-password-label"
            aria-describedby="staff-password-help"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required={!user}
          />
          <small id="staff-password-help" className="muted">
            Передайте пароль лично. Сотрудник сменит его при первом входе.
          </small>
        </label>
        <div className="field">
          {' '}
          <StudentSelect
            id="staff-role"
            label="Роль"
            value={role}
            onChange={(value) => setRole(value === 'admin' ? 'admin' : 'teacher')}
            options={[
              { value: 'teacher', label: 'Учитель' },
              { value: 'admin', label: 'Администратор' },
            ]}
          />
        </div>
        <label className="field">
          <span id="staff-telegram-label">Telegram ID</span>
          <input
            inputMode="numeric"
            aria-labelledby="staff-telegram-label"
            aria-describedby="staff-telegram-help"
            value={telegramId}
            onChange={(event) => setTelegramId(event.target.value.replace(/\D/g, ''))}
            maxLength={16}
            placeholder="Необязательно"
          />
          <small id="staff-telegram-help" className="muted">
            Указанный аккаунт получит эту же роль в боте после /start.
          </small>
        </label>
        {role === 'teacher' && (
          <div className="field">
            <span>Доступные группы</span>
            <div className="staff-groups">
              {groups.map((group) => (
                <label className="staff-check" key={group.id}>
                  <input
                    type="checkbox"
                    checked={groupIds.includes(group.id)}
                    onChange={(event) =>
                      setGroups((current) =>
                        event.target.checked
                          ? [...current, group.id]
                          : current.filter((id) => id !== group.id),
                      )
                    }
                  />
                  <span>
                    {group.name} · {group.courseName}
                  </span>
                </label>
              ))}
              {!groups.length && (
                <p className="muted">Пока нет групп. Учитель сможет создать свою.</p>
              )}
            </div>
          </div>
        )}
        {user && (
          <label className="staff-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>Доступ включён</span>
          </label>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? <Spinner /> : <Check size={18} />}Сохранить сотрудника
        </button>
      </fieldset>
    </form>
  );
}
function AuditList() {
  const [rows, setRows] = useState<AuditEvent[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(true);
  async function load(before?: number) {
    setLoading(true);
    setError('');
    try {
      const page = await api<AuditEvent[]>('/audit' + (before ? '?before=' + before : ''));
      setRows((current) => (before ? [...current, ...page] : page));
      setMore(page.length === 50);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось загрузить журнал');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="staff-list">
      {rows.map((row) => (
        <article className="staff-row" key={row.id}>
          <div className="staff-copy">
            <strong>
              {(
                {
                  'staff.create': 'Создан сотрудник',
                  'staff.update': 'Изменён доступ сотрудника',
                  'password.change': 'Изменён пароль',
                  'course.create': 'Создан курс',
                  'course.update': 'Изменён курс',
                  'course.delete': 'Удалён курс',
                  'group.create': 'Создана группа',
                  'group.update': 'Изменена группа',
                  'group.delete': 'Удалена группа',
                  'student.create': 'Добавлен ученик',
                  'student.update': 'Изменён ученик',
                  'student.delete': 'Удалён ученик',
                  'payment.create': 'Внесена оплата',
                } as Record<string, string>
              )[row.action] ?? row.action}
            </strong>
            <span>
              {row.actor ?? 'Система'} ·{' '}
              {(
                {
                  group: 'группа',
                  student: 'ученик',
                  course: 'курс',
                  staff: 'сотрудник',
                  payment: 'оплата',
                } as Record<string, string>
              )[row.targetType] ?? row.targetType}{' '}
              #{row.targetId}
            </span>
            <small>
              {new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' }).format(
                new Date(row.createdAt),
              )}
            </small>
          </div>
        </article>
      ))}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {more && (
        <button
          className="button secondary full"
          disabled={loading}
          onClick={() => void load(rows.at(-1)?.id)}
        >
          {loading ? <Spinner /> : 'Загрузить ещё'}
        </button>
      )}
    </div>
  );
}

export function ProfilePanel({ onLogout }: { onLogout?: () => Promise<void> }) {
  const { user } = usePermissions();
  const [changing, setChanging] = useState(false);
  return (
    <div className="form">
      <div className="staff-copy">
        <strong>{user?.name ?? 'Локальная разработка'}</strong>
        <span>
          {user ? roleLabel[user.role] : 'Владелец'} · <code>{user?.username}</code>
        </span>
        {user?.telegramId && (
          <span>
            Telegram ID: <code>{user.telegramId}</code>
          </span>
        )}
      </div>
      {changing ? (
        <PasswordChange
          onChanged={() => {
            void onLogout?.();
          }}
        />
      ) : (
        <button className="button secondary full" onClick={() => setChanging(true)}>
          Сменить пароль
        </button>
      )}
      {onLogout && (
        <button className="button destructive full" onClick={() => void onLogout()}>
          Выйти из аккаунта
        </button>
      )}
    </div>
  );
}
