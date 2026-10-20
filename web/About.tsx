import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Code2, Layers, Send, ShieldCheck } from 'lucide-react';
import { project } from '../src/project';
import { FloatingControls } from './FloatingControls';
import { revealTheme } from './theme';

const routes = [
  ['GET /auth/session', 'Проверить сессию и необходимость входа.'],
  ['POST /auth/login', '{username, password} → HttpOnly cookie.'],
  ['POST /auth/logout', 'Отозвать сессию, ответ 204.'],
  ['GET /groups', 'Группы, курсы, валюты, стоимость и число учеников.'],
  ['POST /groups', '{name, courseId} → новая группа, 201.'],
  ['PATCH /groups/:id', '{name?, courseName?, monthlyAmount?}; курс группы фиксирован.'],
  ['DELETE /groups/:id', 'Удалить группу и её учеников с оплатами, 204.'],
  ['GET /courses', 'Общий каталог курсов с валютой, ценой и числом групп.'],
  ['POST /courses', '{name, currency, monthlyAmount} → курс, 201.'],
  ['PATCH /courses/:id', 'Название, валюта или стоимость; новая цена со следующего месяца.'],
  ['DELETE /courses/:id', 'Только неиспользуемый курс, иначе 409.'],
  ['GET /students?groupId=1', 'Ученики всех групп или указанной группы.'],
  ['POST /students', '{name, phone, groupId} → ученик, 201.'],
  ['PATCH /students/:id', 'Изменить имя, телефон или группу.'],
  ['DELETE /students/:id', 'Удалить ученика и его оплаты, 204.'],
  ['GET /students/:id/payments', 'История оплат; ?limit=10 и nextCursor для следующей страницы.'],
  ['POST /students/:id/payments', '{amount, date: "YYYY-MM-DD"} → платёж, 201.'],
  ['GET /students/:id/balance?month=YYYY-MM', '{paid, debt} за выбранный месяц.'],
  ['GET /debtors?month=YYYY-MM&groupId=1', 'Только должники; month и groupId необязательны.'],
  ['GET /balances?month=YYYY-MM&groupId=1', 'Все статусы оплаты, включая полностью оплативших.'],
  ['GET /health', 'Публичная проверка состояния сервера.'],
];
const commands = [
  [
    '/start, /help',
    'Приветствие, роль, Telegram ID моноширинным текстом и справка. Доступны каждому.',
  ],
  ['/about', 'Автор, версия, правила учёта и описание возможностей бота.'],
  ['/groups', 'Выбор группы или всех групп; курс, валюта, текущий тариф и сводка оплат.'],
  ['/debt', 'Должники выбранной группы, страницы и переход по месяцам в том же сообщении.'],
  ['/students', 'Ученики выбранной группы, ID, курс и тариф текущего месяца.'],
  ['/pay', 'Выбор ученика → сумма в сумах → подтверждение. На каждом шаге есть возврат и отмена.'],
  [
    '/pay 12 250000',
    'Быстрая оплата по ID сегодняшней датой, только UZS; сразу записывает платёж.',
  ],
  ['/cancel', 'Отменить текущий ввод.'],
  [
    '/admins',
    'Только владелец: добавление по выбору пользователя, ID или пересылке, удаление с подтверждением и одноразовое приглашение следующему /start в личном чате.',
  ],
];
export function About() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('ledger-theme') ?? 'system';
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    document.title = `О проекте · ${project.name}`;
    document.documentElement.lang = 'ru';
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('ledger-theme', next);
    } catch {
      /* Theme works without storage. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', next === 'dark' ? '#0a0a0a' : '#fafafa');
    setTheme(next);
  }
  return (
    <div className="about-page">
      <header className="about-header">
        <a className="icon-button" href="/" aria-label="Вернуться к учёту оплат">
          <ArrowLeft size={21} />
        </a>
        <span>О проекте</span>
        <span className="about-version">v{project.version}</span>
      </header>
      <main id="about-content">
        <section className="about-intro">
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          <h1>{project.name}</h1>
          <p>
            Учёт оплат учебного центра. Группы, ученики и ежемесячные платежи — в браузере и
            Telegram.
          </p>
          <div className="about-author">
            <span>Автор проекта</span>
            <strong>{project.author}</strong>
          </div>
          <div className="about-links">
            <a
              className="button primary"
              href={`https://t.me/${project.botUsername}`}
              target="_blank"
              rel="noreferrer"
            >
              <Send size={17} />
              Telegram-бот
              <ArrowUpRight size={15} />
            </a>
            <a
              className="button secondary"
              href={project.repository}
              target="_blank"
              rel="noreferrer"
            >
              GitHub
              <ArrowUpRight size={15} />
            </a>
          </div>
        </section>
        <nav className="about-nav" aria-label="Содержание страницы">
          <a href="#features">Возможности</a>
          <a href="#rules">Правила учёта</a>
          <a href="#telegram">Telegram</a>
          <a href="#api">API</a>
          <a href="#setup">Запуск</a>
          <a href="#security">Защита</a>
        </nav>
        <section className="about-section" id="features">
          <h2>
            <Layers size={19} />
            Что умеет сайт
          </h2>
          <ul>
            <li>
              Создание групп и курсов. У курса — название, валюта UZS/USD и месячная стоимость; у
              группы — один закреплённый курс.
            </li>
            <li>
              Выбор группы нажатием или удержанием с перемещением пальца. Создание курса из формы
              группы с возвратом к заполненному черновику.
            </li>
            <li>
              Добавление, редактирование и удаление учеников: имя, телефон с маской +998 (90)
              123-56-78 и выбор «группа • курс».
            </li>
            <li>
              Сводка долга по месяцам, предзагрузка соседних месяцев, свайпы и календарь с колёсами
              месяца и года. Верхняя строка остаётся при прокрутке.
            </li>
            <li>
              Списки «Должники / Ученики», поиск, фильтры «Все / Не оплатившие / В процессе /
              Оплатившие», прогресс оплаты и звонок по номеру.
            </li>
            <li>
              Оплата в нижнем drawer: ученик, сумма, дата, MAX до полного остатка и предварительный
              расчёт. Переплата запрещена.
            </li>
            <li>
              История платежей с предзагрузкой первой страницы и загрузкой следующих порциями по 10.
              Подтверждение удаления группы.
            </li>
            <li>
              Светлая и тёмная темы с раскрытием из кнопки, плавные меню, бегущие длинные названия,
              управление клавиатурой и reduced-motion.
            </li>
            <li>
              Русский язык по умолчанию; узбекский перевод реализован, переключатель языка временно
              скрыт. Увеличение жестом отключено по настройке проекта.
            </li>
          </ul>
        </section>
        <section className="about-section" id="rules">
          <h2>Как считаются оплаты</h2>
          <p>
            Для каждого ученика за выбранный месяц: оплачено — сумма платежей по их дате, долг —
            максимум из нуля и разности тарифа месяца и оплаченного. В середине месяца начисляется
            полная сумма; перенос переплаты между месяцами не ведётся.
          </p>
          <p>
            UZS хранятся целыми сумами, USD — целыми центами: 12 550 в API означает 125,50 $. Валюты
            не складываются и не конвертируются друг в друга. В интерфейсе сумма вводится в валюте
            курса.
          </p>
          <p>
            Изменение цены начинает действовать со следующего месяца по Asia/Tashkent. Текущие и
            прошлые тарифы, суммы и даты платежей сохраняются. Общий курс может использоваться
            несколькими группами, поэтому его новая стоимость применяется ко всем этим группам.
          </p>
          <p>
            Будущие месяцы на сайте и в боте показывают «—». API сохраняет расчётный контракт и
            может вернуть начисления за будущий месяц. Без month используется текущий месяц. По
            простому контракту существующие ученики участвуют и в прошлых месяцах; история
            зачисления и переводов пока не ведётся.
          </p>
          <p>
            Удаление ученика удаляет его оплаты. Удаление группы удаляет только её учеников и
            оплаты; общий курс остаётся, пока нужен другой группе. Валюту курса с учениками менять
            нельзя; ученика с оплатами нельзя перевести в другую валюту.
          </p>
        </section>
        <section className="about-section" id="telegram">
          <h2>
            <Send size={19} />
            Telegram-бот
          </h2>
          <p>
            <a href={`https://t.me/${project.botUsername}`} target="_blank" rel="noreferrer">
              @{project.botUsername}
            </a>{' '}
            работает через long polling в том же процессе и вызывает тот же сервисный слой, что API.
            Ученики, группы, оплаты и тарифы общие: изменения сайта доступны боту сразу.
          </p>
          <dl className="about-commands">
            {commands.map(([command, description]) => (
              <div key={command}>
                <dt>
                  <code>{command}</code>
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
          <p>
            Финансовые команды работают только в личном чате для владельца и администраторов. Выбор
            группы у каждого пользователя свой и сбрасывается после перезапуска бота; по умолчанию
            выбраны все группы. Быстрая оплата по ID работает независимо от фильтра группы. Пресет
            или ручной ввод открывает подтверждение: до него платёж не записывается. Бот принимает
            только сумы (UZS); оплату USD можно внести на сайте. Повторная доставка не создаёт
            дубликат.
          </p>
          <p>
            Создание и редактирование групп, курсов и учеников выполняется в веб-интерфейсе. Бот
            показывает справочники всех валют и принимает оплаты только в сумах; владельца удалить
            из доступа нельзя. Владелец также может включить одноразовую выдачу администратора
            следующему новому пользователю с /start в личном чате. После выдачи режим выключается;
            повторное включение доступно только владельцу. Ожидание и погашение сохраняются после
            перезапуска.
          </p>
        </section>
        <section className="about-section" id="api">
          <h2>
            <Code2 size={19} />
            REST API
          </h2>
          <p>
            JSON, тот же origin. Финансовые маршруты требуют веб-сессию при включённом WEB_PASSWORD.
            Ошибки имеют формат <code>{'{error, details}'}</code>; коды 201 / 204 / 400 / 401 / 403
            / 404 / 409 / 429. CORS выключен.
          </p>
          <div className="about-api">
            {routes.map(([route, description]) => (
              <div key={route}>
                <code>{route}</code>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <p>
            Строка должника:{' '}
            <code>studentId, name, phone, group, monthlyAmount, currency, paid, debt</code>.
            Пагинация истории возвращает <code>items, total, totalAmount, nextCursor</code>;
            следующий запрос использует <code>cursor</code> и <code>limit</code>.
          </p>
          <pre>
            <code>{`POST /students\n{"name":"Азиза Каримова","phone":"+998 (90) 123-56-78","groupId":1}\n\nPOST /students/1/payments\n{"amount":250000,"date":"2026-10-20"}\n\nGET /debtors?month=2026-10&groupId=1`}</code>
          </pre>
        </section>
        <section className="about-section" id="setup">
          <h2>Стек и запуск с нуля</h2>
          <p>
            Node.js 20.19+, TypeScript strict, Fastify + Zod, SQLite через better-sqlite3, grammY,
            React + Vite, Radix UI, Framer Motion и CSS. Один package.json, один процесс и один
            origin. Миграции SQLite выполняются при старте; файл по умолчанию — data/app.db.
          </p>
          <pre>
            <code>{`git clone ${project.repository} ecomdev-ledger\ncd ecomdev-ledger\nnpm install\ncp .env.example .env\nnpm run dev\n\n# Production\nnpm run build\nnpm start\n\n# Проверки\nnpm test\nnpm run lint\nnpm run format:check`}</code>
          </pre>
          <p>
            После копирования .env.example задайте BOT_TOKEN и OWNER_ID для Telegram, а WEB_USERNAME
            и WEB_PASSWORD длиной не менее 6 символов — для защищённого входа. Пустой BOT_TOKEN
            отключает только бота. Без WEB_PASSWORD вход отключён для локальной разработки. Порт по
            умолчанию 3000; если занят, проверяются следующие 50 портов без остановки чужих
            процессов. Репозиторий открыт: для клонирования доступ к аккаунту автора не нужен.
          </p>
          <p>
            Данные: courses → группы → ученики → оплаты; admins задают доступ бота, course_tariffs
            хранят месячные версии цены. Дополнительно хранятся веб-сессии, попытки входа и ключи
            повторных Telegram-платежей.
          </p>
        </section>
        <section className="about-section" id="security">
          <h2>
            <ShieldCheck size={19} />
            Защита и границы проекта
          </h2>
          <p>
            Zod на входах, параметризованные SQL-запросы, внешние ключи и транзакции. Сессии на 12
            часов с HttpOnly / SameSite=Strict, Secure при HTTPS; в базе — хеш токена. Ограничены
            попытки входа, частота запросов, размер тела и время соединения; включены CSP, защита от
            встраивания и проверка origin для записей.
          </p>
          <p>
            BOT_TOKEN и пароль читаются из локального .env и не попадают в клиент, Git или эту
            страницу. Эта справка публичная и содержит только описание проекта. Сервер слушает
            loopback; Cloudflare Tunnel публикует его через временный адрес. Это не полноценная
            защита от распределённого DDoS и не замена постоянному хостингу и резервным копиям.
          </p>
          <p>
            Дальше: индивидуальные веб-аккаунты и роли, журнал изменений, серверная пагинация
            справочников, Docker/CI и экспорт CSV. Для реального центра ещё нужны автоматические
            резервные копии, мониторинг и постоянный домен.
          </p>
        </section>
      </main>
      <FloatingControls
        dark={dark}
        onTheme={(button) => void revealTheme(button, toggleTheme)}
        hidden={false}
      />
    </div>
  );
}
