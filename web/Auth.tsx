import type { StaffUser } from '../src/contracts';
import { SessionContext } from './Session';
import { PasswordChange } from './Staff';
import { useI18n } from './i18n';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookOpen, Eye, EyeOff, Info, Moon, Sun } from 'lucide-react';
import { api } from './api';
import { App } from './App';
import { Spinner } from './components';
import { invalidateHistory } from './history';
import { revealTheme } from './theme';

interface Session {
  authenticationRequired: boolean;
  username: string | null;
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<{ username?: string; password?: string }>({});
  const [dark, setDark] = useState(
    () =>
      document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme &&
        matchMedia('(prefers-color-scheme: dark)').matches),
  );
  const reduced = useReducedMotion();
  function toggleTheme() {
    const theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ledger-theme', theme);
    } catch {
      /* Theme still works without storage. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#fafafa');
    setDark(!dark);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const validation = {
      ...(!username.trim() ? { username: 'Введите логин' } : {}),
      ...(!password ? { password: 'Введите пароль' } : {}),
    };
    setFields(validation);
    setError('');
    if (Object.keys(validation).length) return;
    setBusy(true);
    try {
      onLogin(
        await api<Session>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password }),
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Не удалось войти. Попробуйте снова.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header className="login-header">
        <a className="brand" href="/" aria-label={t('Класс — главная')}>
          <span className="brand-mark">
            <BookOpen size={18} />
          </span>
          <span>{t('класс')}</span>
        </a>
        <div className="login-controls">
          <a className="icon-button" href="/about" aria-label={t('О проекте')}>
            <Info size={19} />
          </a>
          <button
            className="icon-button login-theme"
            aria-label={dark ? t('Включить светлую тему') : t('Включить тёмную тему')}
            onClick={(event) => void revealTheme(event.currentTarget, toggleTheme)}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <main className="login-main">
        <motion.section
          className="login-card"
          aria-labelledby="login-title"
          initial={{ opacity: 0, y: reduced ? 0 : 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="login-emblem" aria-hidden="true">
            <BookOpen size={27} strokeWidth={1.6} />
          </div>
          <h1 id="login-title">{t('Вход')}</h1>
          <form className="login-form" onSubmit={submit} noValidate aria-busy={busy}>
            <label className="field" htmlFor="login-username">
              <span className="sr-only" id="login-username-label">
                {t('Логин')}{' '}
              </span>
              <input
                id="login-username"
                aria-labelledby="login-username-label"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                placeholder={t('Логин')}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setFields((value) => ({ ...value, username: undefined }));
                  setError('');
                }}
                disabled={busy}
                maxLength={100}
                aria-invalid={Boolean(fields.username)}
                aria-describedby={fields.username ? 'login-username-error' : undefined}
                required
              />
              {fields.username && (
                <span id="login-username-error" className="field-error">
                  {t(fields.username)}
                </span>
              )}
            </label>
            <label className="field" htmlFor="login-password">
              <span className="sr-only" id="login-password-label">
                {t('Пароль')}{' '}
              </span>
              <div className="login-password">
                <input
                  id="login-password"
                  aria-labelledby="login-password-label"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  placeholder={t('Пароль')}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFields((value) => ({ ...value, password: undefined }));
                    setError('');
                  }}
                  disabled={busy}
                  maxLength={1024}
                  aria-invalid={Boolean(fields.password)}
                  aria-describedby={fields.password ? 'login-password-error' : undefined}
                  required
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? t('Скрыть пароль') : t('Показать пароль')}
                  aria-pressed={visible}
                  onClick={() => setVisible((value) => !value)}
                  disabled={busy}
                >
                  {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
              {fields.password && (
                <span id="login-password-error" className="field-error">
                  {t(fields.password)}
                </span>
              )}
            </label>
            <AnimatePresence>
              {error && (
                <motion.p
                  className="login-error"
                  role="alert"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {t(error)}
                </motion.p>
              )}
            </AnimatePresence>
            <button type="submit" className="button primary full login-submit" disabled={busy}>
              {busy ? (
                <>
                  <Spinner />
                  {t('Входим…')}{' '}
                </>
              ) : (
                <>{t('Войти')}</>
              )}
            </button>
          </form>
        </motion.section>
      </main>
    </div>
  );
}

export function Auth() {
  const { t, language } = useI18n();

  const [session, setSession] = useState<Session>();
  const [profile, setProfile] = useState<StaffUser | null>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<Session>('/auth/session', { signal: controller.signal })
      .then(setSession)
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : t('Не удалось подключиться к серверу'));
      });
    return () => controller.abort();
  }, [attempt, t]);
  useEffect(() => {
    const expired = () => {
      invalidateHistory();
      setSession({ authenticationRequired: true, username: null });
      setError('');
    };
    window.addEventListener('ledger:session-expired', expired);
    return () => window.removeEventListener('ledger:session-expired', expired);
  }, []);
  const authenticated = session && (!session.authenticationRequired || Boolean(session.username));
  useEffect(() => {
    setProfile(undefined);
    if (!session?.username) {
      setProfile(null);
      return;
    }
    const abort = new AbortController();
    void api<StaffUser | null>('/auth/profile', { signal: abort.signal })
      .then((value) => {
        if (abort.signal.aborted) return;
        if (session.authenticationRequired && !value) {
          invalidateHistory();
          setSession({ authenticationRequired: true, username: null });
          return;
        }
        setProfile(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setError(error instanceof Error ? error.message : 'Не удалось загрузить профиль');
      });
    return () => abort.abort();
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const path = authenticated ? '/' : '/login';
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
    document.title = authenticated ? t('Класс · Учёт оплат') : t('Вход · Класс');
  }, [session, authenticated, language, t]);
  const logout = useCallback(async () => {
    setLoggingOut(true);
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      invalidateHistory();
      setSession({ authenticationRequired: true, username: null });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Не удалось выйти'));
    } finally {
      setLoggingOut(false);
    }
  }, [t]);
  if (!session)
    return (
      <main className="auth-loading">
        <span className="brand-mark">
          <BookOpen size={21} />
        </span>
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
              {t('Повторить')}{' '}
            </button>
          </>
        ) : (
          <span role="status" className="loading-inline">
            <Spinner />
            {t('Загрузка…')}{' '}
          </span>
        )}
      </main>
    );
  if (!authenticated)
    return (
      <Login
        onLogin={(value) => {
          setSession(value);
          setError('');
        }}
      />
    );
  if (profile === undefined)
    return (
      <main className="auth-loading">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </button>
          </>
        ) : (
          <Spinner />
        )}
      </main>
    );
  if (profile?.mustChangePassword)
    return (
      <main className="auth-loading">
        <section className="login-card">
          <h1>Смените временный пароль</h1>
          <PasswordChange
            onChanged={() => {
              invalidateHistory();
              setSession({ authenticationRequired: true, username: null });
            }}
          />
        </section>
      </main>
    );
  return (
    <SessionContext.Provider value={profile}>
      {error && (
        <p className="auth-session-error" role="alert">
          {t(error)}
        </p>
      )}
      <App onLogout={session.authenticationRequired ? logout : undefined} loggingOut={loggingOut} />
    </SessionContext.Provider>
  );
}
