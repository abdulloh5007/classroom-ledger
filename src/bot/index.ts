import { project } from '../project.js';
import { monthSchema, moneySchema, type Group, type Student } from '../contracts.js';
import { randomBytes, randomInt } from 'node:crypto';
import { Bot, GrammyError, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { ZodError } from 'zod';
import { currentMonth, formatMoney, shiftMonth, today } from '../calendar.js';
import { AppError } from '../errors.js';
import { LedgerService, parseAmount } from '../services/ledger.js';
import { html, short, block, rich, UZS_ONLY } from './messages.js';

const publicCommands = [
  { command: 'start', description: 'Профиль и главное меню' },
  { command: 'help', description: 'Как пользоваться ботом' },
  { command: 'about', description: 'О проекте и авторе' },
];
const commands = [
  ...publicCommands,
  { command: 'groups', description: 'Выбрать группу' },
  { command: 'debt', description: 'Должники по месяцам' },
  { command: 'pay', description: 'Внести оплату в сумах' },
  { command: 'students', description: 'Ученики и их карточки' },
  { command: 'cancel', description: 'Отменить ввод' },
];
type Origin = { kind: 's' | 'c' | 'd'; page: number; groupId?: number; month?: string };
type Page = { text: string; keyboard: InlineKeyboard };
type PayIntent = {
  kind: 'pay';
  studentId: number;
  token: string;
  step: 'amount' | 'manual' | 'confirm';
  origin: Origin;
  amount?: number;
  date?: string;
  expires: number;
};
type Pending = PayIntent | { kind: 'admin'; requestId: number; expires: number };
const ADMIN_BACK = '‹ К администраторам';
const CANCEL = '✕ Отмена';

export function createBot(token: string, service: LedgerService) {
  const bot = new Bot(token, { client: { timeoutSeconds: 35 } });
  const pending = new Map<number, Pending>();
  const selectedGroups = new Map<number, number>();
  let stopped = false;
  const htmlOptions = { parse_mode: 'HTML' } as const;
  const scope = (id?: number) => (id === undefined ? 'all' : String(id));
  const originData = (origin: Origin) =>
    `${origin.kind}:${origin.kind === 'd' ? `${origin.month}:` : ''}${origin.page}:${scope(origin.groupId)}`;
  const profileData = (studentId: number, origin: Origin) =>
    `profile:${studentId}:${originData(origin)}`;
  function selectedGroup(userId: number): number | undefined {
    const id = selectedGroups.get(userId);
    if (id && !service.groups().some((group) => group.id === id)) {
      selectedGroups.delete(userId);
      return undefined;
    }
    return id;
  }
  function groupFromScope(value?: string): number | undefined {
    return value && value !== 'all' ? service.group(Number(value)).id : undefined;
  }
  function readOrigin(value: string): Origin {
    const match = /^(s|c|d):(?:(\d{4}-\d{2}):)?(\d{1,9}):(all|\d+)$/.exec(value);
    if (!match || (match[1] === 'd') !== Boolean(match[2]))
      throw new AppError(400, 'Кнопка устарела. Откройте список заново.');
    if (match[2]) monthSchema.parse(match[2]);
    return {
      kind: match[1] as Origin['kind'],
      month: match[2],
      page: Number(match[3]),
      groupId: groupFromScope(match[4]),
    };
  }
  function backData(origin: Origin): string {
    return origin.kind === 'd'
      ? `debt:${origin.month}:${origin.page}:${scope(origin.groupId)}`
      : `${origin.kind === 'c' ? 'choose' : 'students'}:${origin.page}:${scope(origin.groupId)}`;
  }
  function rememberGroup(userId: number, id?: number) {
    if (id === undefined) selectedGroups.delete(userId);
    else selectedGroups.set(userId, id);
  }
  const state = (id: number): Pending | undefined => {
    const value = pending.get(id);
    if (value && value.expires > Date.now()) return value;
    pending.delete(id);
    return undefined;
  };
  function mainButton(keyboard = new InlineKeyboard()) {
    return keyboard.row().text('⌂ Главное меню', 'nav:home');
  }
  function menu(userId: number, allowed = service.canAccess(userId)): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    if (allowed) {
      keyboard
        .text('◫ Группы', 'nav:groups')
        .primary()
        .text('◷ Должники', 'nav:debt')
        .row()
        .text('♙ Ученики', 'nav:students')
        .text('＋ Оплата в сумах', 'nav:pay')
        .success()
        .row();
      if (service.isOwner(userId)) keyboard.text('⚙ Администраторы', 'nav:admins').row();
    }
    return keyboard.text('？ Помощь', 'nav:help').text('ⓘ О проекте', 'nav:about');
  }
  async function send(ctx: Context, page: Page) {
    await ctx.reply(page.text, { ...htmlOptions, reply_markup: page.keyboard });
  }
  async function editPage(ctx: Context, text: string, keyboard: InlineKeyboard) {
    try {
      await ctx.editMessageText(text, { ...htmlOptions, reply_markup: keyboard });
    } catch (error) {
      if (!(error instanceof GrammyError && error.description.includes('message is not modified')))
        throw error;
    }
  }
  async function show(ctx: Context, page: Page) {
    if (ctx.callbackQuery?.message) await editPage(ctx, page.text, page.keyboard);
    else await send(ctx, page);
  }
  async function finishInput(ctx: Context, notice?: string) {
    const intent = ctx.from ? state(ctx.from.id) : undefined;
    if (ctx.from) pending.delete(ctx.from.id);
    if (intent?.kind === 'admin')
      await ctx.reply(
        rich('↩️ Ввод завершён', notice ?? 'Клавиатура выбора пользователя закрыта.'),
        { ...htmlOptions, reply_markup: { remove_keyboard: true } },
      );
  }
  function homePage(ctx: Context): Page {
    const user = ctx.from!;
    const allowed = ctx.chat?.type === 'private' && service.canAccess(user.id);
    const role = service.isOwner(user.id) ? 'Владелец' : allowed ? 'Администратор' : 'Гость';
    const profile = block(
      `Имя: <b>${html([user.first_name, user.last_name].filter(Boolean).join(' '))}</b>`,
      `Telegram ID: <code>${user.id}</code>`,
      `Роль: <b>${role}</b>`,
    );
    const groupId = allowed ? selectedGroup(user.id) : undefined;
    return {
      text: rich(
        `Привет, ${html(user.first_name)}! 👋`,
        `Добро пожаловать в <b>${project.name}</b> — учёт оплат учебного центра.\n\n${profile}`,
        allowed
          ? `Группа: <b>${groupId ? short(service.group(groupId).name) : 'Все группы'}</b>\nВыберите действие кнопкой ниже.\n<i>Приём оплат в боте — только в сумах.</i>`
          : 'Чтобы получить доступ, передай владельцу свой Telegram ID.\n<tg-spoiler>Ученики и оплаты видны только владельцу и администраторам.</tg-spoiler>',
      ),
      keyboard: menu(user.id, allowed),
    };
  }
  function helpPage(ctx: Context): Page {
    const allowed = ctx.chat?.type === 'private' && service.canAccess(ctx.from!.id);
    return {
      text: rich(
        '🧭 Как пользоваться',
        allowed
          ? `${block('<b>1. Выберите группу</b>', 'Группы → нужная группа или «Все группы».')}\n\n${block('<b>2. Откройте ученика</b>', 'Ученики или должники → карточка → оплата.')}\n\n${block('<b>3. Проверьте сумму</b>', 'Пресет или ручной ввод → подтверждение. Кнопки «Назад» и «Отмена» возвращают без записи оплаты.')}\n\n${block(html(UZS_ONLY))}\n\n<b>Быстрые команды</b>\n/groups · /students · /debt · /pay\n/pay <code>12 250000</code> — сразу внести оплату по ID\n/cancel — отменить ввод\n\n<i>Дата — по Ташкенту. Новый тариф действует со следующего месяца; история сохраняется. Справочники изменяются на сайте.</i>`
          : `${block('Отправьте /start, чтобы узнать свой Telegram ID.', 'Передайте ID владельцу центра для получения доступа.')}\n\n${html(UZS_ONLY)}`,
        'Выбор группы личный и сбрасывается после перезапуска бота.',
      ),
      keyboard: mainButton(
        allowed
          ? new InlineKeyboard().text('◫ Выбрать группу', 'nav:groups').primary()
          : new InlineKeyboard(),
      ),
    };
  }
  function aboutPage(): Page {
    return {
      text: rich(
        `📚 ${project.name} · v${project.version}`,
        block(
          `Автор: <b>${html(project.author)}</b>`,
          'Общая база сайта и Telegram: группы, курсы, ученики, тарифы и история оплат.',
        ) +
          `\n\n<b>В боте</b>\n• Выбор группы и карточки учеников\n• Должники по месяцам\n• Оплата в сумах с подтверждением\n• Управление администраторами владельцем\n\n${block(html(UZS_ONLY))}`,
        'Полная справка сайта — на странице <code>/about</code>. Группы и курсы создаются на сайте.',
      ),
      keyboard: mainButton(new InlineKeyboard().text('？ Помощь', 'nav:help')),
    };
  }
  async function syncMenu(id: number): Promise<void> {
    try {
      await bot.api.setMyCommands(
        service.isOwner(id)
          ? [...commands, { command: 'admins', description: 'Управление администраторами' }]
          : service.canAccess(id)
            ? commands
            : publicCommands,
        { scope: { type: 'chat', chat_id: id } },
      );
    } catch {
      console.warn('Меню команд будет обновлено после /start пользователя.');
    }
  }
  function recovery(ctx: Context): InlineKeyboard {
    const intent = ctx.from ? state(ctx.from.id) : undefined;
    if (intent?.kind === 'pay')
      return mainButton(
        new InlineKeyboard()
          .text('‹ К суммам', `amount:${intent.token}`)
          .text('✕ Отмена', 'nav:cancel'),
      );
    if (intent?.kind === 'admin')
      return mainButton(new InlineKeyboard().text('‹ Администраторы', 'nav:admins'));
    return mainButton(new InlineKeyboard().text('＋ Оплата в сумах', 'nav:pay').success());
  }
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof ZodError || error instanceof AppError) {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
        const reason =
          error instanceof ZodError
            ? error.issues.map((issue) => issue.message).join('; ')
            : error.message;
        const keyboard =
          ctx.from && service.canAccess(ctx.from.id) && ctx.chat?.type === 'private'
            ? recovery(ctx)
            : menu(ctx.from?.id ?? 0, false);
        await send(ctx, {
          text: rich(
            '⚠️ Проверьте действие',
            block(html(reason)),
            'Измените ввод или вернитесь назад.',
          ),
          keyboard,
        });
        return;
      }
      throw error;
    }
  });
  bot.command(['start', 'help', 'about'], async (ctx) => {
    if (!ctx.from) return;
    await finishInput(ctx);
    const command = (ctx.msg?.text ?? '').split(/\s/)[0]?.split('@')[0];
    const promoted =
      command === '/start' &&
      ctx.chat.type === 'private' &&
      ctx.from.is_bot === false &&
      ctx.message !== undefined
        ? service.claimNextAdmin(ctx.from.id, ctx.message.date)
        : false;
    if (ctx.chat.type === 'private') await syncMenu(ctx.from.id);
    const page =
      (ctx.msg?.text ?? '').split(/\s/)[0]?.split('@')[0] === '/help'
        ? helpPage(ctx)
        : (ctx.msg?.text ?? '').split(/\s/)[0]?.split('@')[0] === '/about'
          ? aboutPage()
          : homePage(ctx);
    if (promoted)
      page.text +=
        '\n\n' +
        block(
          '✅ <b>Доступ администратора выдан</b>',
          'Вы получили одноразовое приглашение владельца. Выберите действие в меню.',
        );
    if (ctx.chat.type !== 'private') {
      page.keyboard = new InlineKeyboard().url(
        'Открыть личный чат',
        `https://t.me/${bot.botInfo.username}`,
      );
      page.text += '\n\n<i>Для работы открой личный чат с ботом.</i>';
    }
    await send(ctx, page);
  });
  bot.callbackQuery(/^nav:(home|help|about)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(
      ctx,
      ctx.match[1] === 'help'
        ? helpPage(ctx)
        : ctx.match[1] === 'about'
          ? aboutPage()
          : homePage(ctx),
    );
  });
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id || !service.canAccess(id)) {
      if (ctx.callbackQuery)
        await ctx.answerCallbackQuery({ text: 'Доступ только для сотрудников', show_alert: true });
      else if (ctx.chat)
        await send(ctx, {
          text: rich(
            '🔒 Доступ закрыт',
            `Доступ к учёту оплат разрешён только владельцу и администраторам.\n\n${block(`Твой Telegram ID: <code>${id ?? 'не определён'}</code>`)}\n\nПередайте ID владельцу или откройте свой профиль.`,
          ),
          keyboard: menu(id ?? 0, false),
        });
      return;
    }
    if (ctx.chat?.type !== 'private') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Откройте личный чат с ботом' });
      else
        await send(ctx, {
          text: rich('🔐 Только личный чат', 'Для работы с оплатами откройте личный чат с ботом.'),
          keyboard: new InlineKeyboard().url(
            'Открыть бота',
            `https://t.me/${bot.botInfo.username}`,
          ),
        });
      return;
    }
    await next();
  });
  function contextLine(group: Group, size = 24): string {
    return `Группа: <b>${short(group.name, size)}</b>\nКурс: <b>${short(group.courseName, size)}</b>`;
  }
  function totals(rows: { currency: 'UZS' | 'USD'; debt: number }[]): string {
    return (
      [...new Set(rows.map((r) => r.currency))]
        .map((currency) =>
          formatMoney(
            rows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.debt, 0),
            currency,
          ),
        )
        .join(' + ') || '0 сум'
    );
  }
  function groupsPage(rawPage = 0): Page {
    const groups = service.groups(),
      pages = Math.max(1, Math.ceil(groups.length / 6)),
      page = Math.max(0, Math.min(rawPage, pages - 1));
    const keyboard = new InlineKeyboard().text('◫ Все группы', 'group:all').primary().row();
    for (const group of groups.slice(page * 6, page * 6 + 6))
      keyboard.text(`${group.name.slice(0, 35)} · #${group.id}`, `group:${group.id}`).row();
    if (page > 0) keyboard.text('‹ Назад', `groups:${page - 1}`);
    if (page < pages - 1) keyboard.text('Далее ›', `groups:${page + 1}`);
    const entries = groups
      .slice(page * 6, page * 6 + 6)
      .map(
        (g) =>
          `<b>${short(g.name, 24)}</b> · <code>#${g.id}</code>\nКурс: ${short(g.courseName, 24)}\nТариф: <code>${formatMoney(service.courseTariff(g.courseId), g.currency)}</code> · Учеников: ${g.studentCount}`,
      )
      .join('\n\n');
    return {
      text: rich(
        '◫ Выберите группу',
        entries
          ? `<blockquote expandable>${entries}</blockquote>`
          : block('Групп пока нет. Создайте группу на сайте.'),
        `Страница ${page + 1}/${pages} · Тариф за <code>${currentMonth()}</code>`,
      ),
      keyboard: mainButton(keyboard),
    };
  }
  function groupOverview(groupId?: number): Page {
    const group = groupId === undefined ? undefined : service.group(groupId),
      rows = service.monthlyBalances(currentMonth(), groupId);
    const keyboard = new InlineKeyboard()
      .text('◷ Должники', `view:debt:${scope(groupId)}`)
      .primary()
      .text('♙ Ученики', `view:students:${scope(groupId)}`)
      .row();
    if (!group || group.currency === 'UZS')
      keyboard
        .text('＋ Оплата в сумах', `view:pay:${scope(groupId)}`)
        .success()
        .row();
    keyboard.text('‹ К группам', 'groups:0');
    return {
      text: rich(
        '◫ ' + (group ? 'Выбрана группа' : 'Все группы'),
        block(
          ...(group
            ? [
                contextLine(group, 60),
                `Тариф: <code>${formatMoney(service.courseTariff(group.courseId), group.currency)}</code>`,
              ]
            : []),
          `Месяц: <code>${currentMonth()}</code>`,
          `Учеников: <b>${rows.length}</b>`,
          `Должники: <b>${rows.filter((r) => r.debt > 0).length} / ${rows.length}</b>`,
          `Осталось собрать: <code>${totals(rows)}</code>`,
        ),
        group?.currency === 'USD'
          ? html(UZS_ONLY)
          : 'Откройте список или внесите оплату кнопкой ниже.',
      ),
      keyboard: mainButton(keyboard),
    };
  }
  function debtPage(month: string, rawPage = 0, groupId?: number): Page {
    monthSchema.parse(month);
    const group = groupId === undefined ? undefined : service.group(groupId),
      future = month > currentMonth(),
      rows = future ? [] : service.debtors(month, groupId),
      pages = Math.max(1, Math.ceil(rows.length / 4)),
      page = Math.max(0, Math.min(rawPage, pages - 1));
    const origin: Origin = { kind: 'd', page, month, groupId };
    const selected = rows.slice(page * 4, page * 4 + 4);
    const entries = selected
      .map(
        (r) =>
          `<b>${short(r.name, 36)}</b> · <code>#${r.studentId}</code>\n${contextLine(group ?? service.group(service.student(r.studentId).groupId), 22)}\nТариф: <code>${formatMoney(r.monthlyAmount, r.currency)}</code>\nОплачено: <code>${formatMoney(r.paid, r.currency)}</code> · Долг: <code>${formatMoney(r.debt, r.currency)}</code>`,
      )
      .join('\n\n');
    const keyboard = new InlineKeyboard();
    if (month !== '1900-01')
      keyboard.text('‹ Пред.', `debt:${shiftMonth(month, -1)}:0:${scope(groupId)}`).primary();
    if (month !== '9999-11')
      keyboard.text('След. ›', `debt:${shiftMonth(month, 1)}:0:${scope(groupId)}`).primary();
    if (month !== currentMonth())
      keyboard.row().text('Текущий месяц', `debt:${currentMonth()}:0:${scope(groupId)}`);
    if (pages > 1) {
      keyboard.row();
      if (page > 0) keyboard.text('‹ Страница', `debt:${month}:${page - 1}:${scope(groupId)}`);
      if (page < pages - 1)
        keyboard.text('Страница ›', `debt:${month}:${page + 1}:${scope(groupId)}`);
    }
    for (const r of selected)
      keyboard
        .row()
        .text(`♙ ${r.name.slice(0, 28)} · #${r.studentId}`, profileData(r.studentId, origin));
    keyboard.row().text('‹ К группе', `group:${scope(groupId)}`);
    return {
      text: rich(
        `◷ Задолженность · ${month}`,
        `Группа: <b>${group ? short(group.name) : 'Все группы'}</b>\n\n${future ? block('Месяц ещё не начался. Данные: —') : entries ? `<blockquote expandable>${entries}</blockquote>` : block('✓ Должников нет.')}\n\nИтого: <code>${future ? '—' : totals(rows)}</code>`,
        `Должников: ${future ? '—' : rows.length} · Страница ${page + 1}/${pages}`,
      ),
      keyboard: mainButton(keyboard),
    };
  }
  function studentsPage(rawPage: number, choose: boolean, groupId?: number): Page {
    const group = groupId === undefined ? undefined : service.group(groupId);
    const all = service.students(groupId),
      students = choose ? all.filter((s) => s.currency === 'UZS') : all;
    const page = Math.max(0, Math.min(rawPage, Math.max(0, Math.ceil(students.length / 6) - 1))),
      selected = students.slice(page * 6, page * 6 + 6),
      prefix = choose ? 'choose' : 'students',
      origin: Origin = { kind: choose ? 'c' : 's', page, groupId };
    const keyboard = new InlineKeyboard();
    for (const student of selected)
      keyboard
        .text(
          `${choose ? '＋' : '♙'} ${student.name.slice(0, 32)} · #${student.id}`,
          `${choose ? 'student' : 'profile'}:${student.id}:${originData(origin)}`,
        )
        .row();
    if (page > 0) keyboard.text('‹ Назад', `${prefix}:${page - 1}:${scope(groupId)}`);
    if ((page + 1) * 6 < students.length)
      keyboard.text('Далее ›', `${prefix}:${page + 1}:${scope(groupId)}`);
    keyboard.row().text('‹ К группе', `group:${scope(groupId)}`);
    const entries = selected
      .map(
        (s) =>
          `<code>#${s.id}</code> <b>${short(s.name, 36)}</b>\n${contextLine(group ?? service.group(s.groupId), 22)}\nТариф: <code>${formatMoney(service.courseTariff(s.courseId), s.currency)}</code>`,
      )
      .join('\n\n');
    return {
      text: rich(
        choose ? '＋ Оплата в сумах' : '♙ Ученики',
        `Группа: <b>${group ? short(group.name) : 'Все группы'}</b>\n\n${entries ? `<blockquote expandable>${entries}</blockquote>` : block(choose && all.some((s) => s.currency === 'USD') ? html(UZS_ONLY) : 'Учеников пока нет. Добавьте их на сайте.')}`,
        `Всего: ${students.length} · Страница ${page + 1}/${Math.max(1, Math.ceil(students.length / 6))}${choose ? '\n<i>Выберите ученика. На следующем шаге — сумма.</i>' : ''}`,
      ),
      keyboard: mainButton(keyboard),
    };
  }
  function studentPage(student: Student, origin: Origin): Page {
    const balance = service.balance(student.id),
      group = service.group(student.groupId);
    const keyboard = new InlineKeyboard();
    if (student.currency === 'UZS' && balance.debt > 0)
      keyboard
        .text('＋ Внести оплату', `student:${student.id}:${originData(origin)}`)
        .success()
        .row();
    keyboard.text('‹ Назад', backData(origin));
    return {
      text: rich(
        '♙ Карточка ученика',
        block(
          `<b>${short(student.name, 60)}</b>`,
          `ID: <code>${student.id}</code>`,
          contextLine(group, 40),
          `Телефон: <code>${html(student.phone)}</code>`,
          `Месяц: <code>${currentMonth()}</code>`,
          `Тариф: <code>${formatMoney(service.courseTariff(student.courseId), student.currency)}</code>`,
          `Оплачено: <code>${formatMoney(balance.paid, student.currency)}</code>`,
          `Осталось: <code>${formatMoney(balance.debt, student.currency)}</code>`,
        ),
        student.currency === 'USD'
          ? html(UZS_ONLY)
          : balance.debt === 0
            ? '✓ За текущий месяц всё оплачено.'
            : 'Нажмите «Внести оплату», чтобы выбрать сумму.',
      ),
      keyboard: mainButton(keyboard),
    };
  }
  function payableStudent(id: number): Student {
    const student = service.student(id);
    if (student.currency !== 'UZS') throw new AppError(400, UZS_ONLY);
    return student;
  }
  function amountPage(intent: PayIntent): Page {
    const student = payableStudent(intent.studentId),
      balance = service.balance(student.id),
      keyboard = new InlineKeyboard();
    if (balance.debt === 0) return studentPage(student, intent.origin);
    for (const amount of new Set(
      [balance.debt, 100000, 250000].filter((value) => value > 0 && value <= balance.debt),
    ))
      keyboard
        .text(
          amount === balance.debt ? `Весь остаток · ${formatMoney(amount)}` : formatMoney(amount),
          `pay:${intent.token}:${amount}`,
        )
        .success()
        .row();
    keyboard
      .text('✎ Ввести вручную', `manual:${intent.token}`)
      .primary()
      .row()
      .text(
        '‹ Назад',
        intent.origin.kind === 'c'
          ? backData(intent.origin)
          : profileData(student.id, intent.origin),
      )
      .text('✕ Отмена', 'nav:cancel');
    return {
      text: rich(
        '＋ Выберите сумму',
        block(
          `<b>${short(student.name, 60)}</b> · <code>#${student.id}</code>`,
          contextLine(service.group(student.groupId), 40),
          `Месяц: <code>${currentMonth()}</code>`,
          `Остаток: <code>${formatMoney(balance.debt)}</code>`,
        ),
        'Нажатие суммы открывает подтверждение. Оплата ещё не записана.',
      ),
      keyboard: mainButton(keyboard),
    };
  }
  function confirmation(intent: PayIntent, amount: number): Page {
    moneySchema.parse(amount);
    const student = payableStudent(intent.studentId),
      balance = service.balance(student.id);
    if (amount > balance.debt)
      throw new AppError(400, 'Сумма превышает остаток долга. Выберите другую сумму.');
    return {
      text: rich(
        '✓ Подтвердите оплату',
        block(
          `<b>${short(student.name, 60)}</b> · <code>#${student.id}</code>`,
          contextLine(service.group(student.groupId), 40),
          `Сумма: <code>${formatMoney(amount)}</code>`,
          `Дата: <code>${intent.date ?? today()}</code>`,
          `После оплаты останется: <code>${formatMoney(balance.debt - amount)}</code>`,
        ),
        'Проверьте ученика и сумму. Платёж запишется только после подтверждения.',
      ),
      keyboard: mainButton(
        new InlineKeyboard()
          .text('✓ Подтвердить оплату', `confirm:${intent.token}`)
          .success()
          .row()
          .text('‹ К суммам', `amount:${intent.token}`)
          .text('✕ Отмена', 'nav:cancel'),
      ),
    };
  }
  function moveIntent(
    userId: number,
    intent: PayIntent,
    step: PayIntent['step'],
    amount?: number,
  ): PayIntent {
    const next: PayIntent = {
      ...intent,
      token: randomBytes(8).toString('hex'),
      step,
      amount,
      date: step === 'confirm' ? today() : undefined,
      expires: Date.now() + 15 * 60_000,
    };
    pending.set(userId, next);
    return next;
  }
  async function review(ctx: Context, intent: PayIntent, amount: number) {
    // Validate before replacing the previous input state; invalid manual input stays editable.
    confirmation(intent, amount);
    const next = moveIntent(ctx.from!.id, intent, 'confirm', amount);
    await show(ctx, confirmation(next, amount));
  }
  async function pay(
    ctx: Context,
    studentId: number,
    amount: number,
    key: string,
    origin?: Origin,
    expectedDate?: string,
  ) {
    if (expectedDate && expectedDate !== today())
      throw new AppError(
        400,
        'Дата изменилась. Вернитесь к выбору суммы и подтвердите новую дату.',
      );
    const student = payableStudent(studentId);
    const payment = service.addPayment(student.id, { amount, date: today() }, key);
    const balance = service.balance(student.id, payment.date.slice(0, 7));
    pending.delete(ctx.from!.id);
    const back = origin ?? { kind: 's' as const, page: 0, groupId: student.groupId };
    await send(ctx, {
      text: rich(
        '✅ Оплата внесена',
        block(
          `<b>${short(student.name, 60)}</b>`,
          `ID: <code>${student.id}</code>`,
          contextLine(service.group(student.groupId), 40),
          `Сумма: <code>${formatMoney(payment.amount)}</code>`,
          `Дата: <code>${payment.date}</code>`,
          `Остаток долга: <code>${formatMoney(balance.debt)}</code>`,
        ),
        'Платёж сохранён в общей истории сайта и бота.',
      ),
      keyboard: mainButton(
        new InlineKeyboard()
          .text('♙ Карточка ученика', profileData(student.id, back))
          .row()
          .text('＋ Ещё оплата', `choose:0:${scope(back.groupId)}`)
          .success(),
      ),
    });
  }
  function adminPage(rawPage = 0): Page {
    const enrollment = service.nextAdminEnrollment(service.ownerId!);
    const admins = service.admins(),
      pages = Math.max(1, Math.ceil(admins.length / 10)),
      page = Math.max(0, Math.min(rawPage, pages - 1));
    const keyboard = new InlineKeyboard()
      .text('＋ Добавить администратора', 'admin:add')
      .success()
      .row();
    if (enrollment.enabled)
      keyboard.text('Отменить админа по /start', 'admin:next:off').danger().row();
    else keyboard.text('＋ Админ по следующему /start', 'admin:next:arm').primary().row();
    for (const admin of admins.slice(page * 10, page * 10 + 10))
      keyboard
        .text(`Удалить · ${admin.telegramId}`, `admin:ask:${admin.telegramId}`)
        .danger()
        .row();
    if (page > 0) keyboard.text('‹ Назад', `admins:${page - 1}`);
    if (page < pages - 1) keyboard.text('Далее ›', `admins:${page + 1}`);
    return {
      text: rich(
        '⚙ Администраторы',
        block(
          `Владелец: <code>${service.ownerId}</code>`,
          'Владельца удалить нельзя.',
          enrollment.enabled
            ? '🟢 Следующий новый пользователь с /start в личном чате получит права администратора. Затем режим отключится.'
            : 'Автовыдача по /start выключена.',
        ) +
          '\n\n' +
          (admins.length
            ? admins
                .slice(page * 10, page * 10 + 10)
                .map((admin) => `• <code>${admin.telegramId}</code>`)
                .join('\n')
            : 'Дополнительных администраторов нет.'),
        `Страница ${page + 1}/${pages}\n<tg-spoiler>Только владелец может менять доступ.</tg-spoiler>`,
      ),
      keyboard: mainButton(keyboard),
    };
  }
  async function renderAction(ctx: Context, action: string) {
    const id = selectedGroup(ctx.from!.id);
    if (action === 'admins' && !service.isOwner(ctx.from!.id))
      throw new AppError(403, 'Управлять администраторами может только владелец.');
    await finishInput(ctx);
    const page =
      action === 'groups'
        ? groupsPage()
        : action === 'debt'
          ? debtPage(currentMonth(), 0, id)
          : action === 'students'
            ? studentsPage(0, false, id)
            : action === 'pay'
              ? studentsPage(0, true, id)
              : action === 'admins'
                ? adminPage()
                : homePage(ctx);
    await show(ctx, page);
  }
  bot.command(['groups', 'debt', 'students', 'admins'], async (ctx) => {
    await renderAction(ctx, (ctx.msg?.text ?? '').split(/\s/)[0]!.slice(1).split('@')[0]!);
  });
  bot.command('cancel', async (ctx) => {
    pending.delete(ctx.from!.id);
    await ctx.reply(rich('↩️ Ввод отменён', 'Можно выбрать другое действие.'), {
      ...htmlOptions,
      reply_markup: { remove_keyboard: true },
    });
    await send(ctx, homePage(ctx));
  });
  bot.callbackQuery(/^nav:(groups|debt|students|pay|admins|cancel)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderAction(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(/^groups:(\d{1,9})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(ctx, groupsPage(Number(ctx.match[1])));
  });
  bot.callbackQuery(/^group:(all|\d+)$/, async (ctx) => {
    const id = groupFromScope(ctx.match[1]);
    rememberGroup(ctx.from!.id, id);
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(ctx, groupOverview(id));
  });
  bot.callbackQuery(/^debt:(\d{4}-\d{2}):(\d{1,9})(?::(all|\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(ctx, debtPage(ctx.match[1]!, Number(ctx.match[2]), groupFromScope(ctx.match[3])));
  });
  bot.callbackQuery(/^(students|choose):(\d{1,9})(?::(all|\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(
      ctx,
      studentsPage(Number(ctx.match[2]), ctx.match[1] === 'choose', groupFromScope(ctx.match[3])),
    );
  });
  bot.callbackQuery(/^view:(debt|students|pay):(all|\d+)$/, async (ctx) => {
    const id = groupFromScope(ctx.match[2]);
    rememberGroup(ctx.from!.id, id);
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(
      ctx,
      ctx.match[1] === 'debt'
        ? debtPage(currentMonth(), 0, id)
        : studentsPage(0, ctx.match[1] === 'pay', id),
    );
  });
  bot.callbackQuery(/^profile:(\d+):(.+)$/, async (ctx) => {
    const origin = readOrigin(ctx.match[2]!);
    const student = service.student(Number(ctx.match[1]));
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    await show(ctx, studentPage(student, origin));
  });
  bot.command('pay', async (ctx) => {
    await finishInput(ctx);
    if (!ctx.match.trim()) {
      await show(ctx, studentsPage(0, true, selectedGroup(ctx.from!.id)));
      return;
    }
    const match = /^(\d+)\s+([\d., \u00a0\u202f]+)$/.exec(ctx.match.trim());
    if (!match) {
      await send(ctx, {
        text: rich(
          '✎ Формат оплаты',
          block('/pay <code>12 250000</code>', 'ID ученика и целая сумма в сумах.'),
          'Или выберите ученика кнопками.',
        ),
        keyboard: mainButton(new InlineKeyboard().text('＋ Выбрать ученика', 'nav:pay').success()),
      });
      return;
    }
    const student = payableStudent(Number(match[1]));
    await pay(ctx, student.id, parseAmount(match[2]!, 'UZS'), `update:${ctx.update.update_id}`);
  });
  bot.callbackQuery(/^student:(\d+)(?::(.+))?$/, async (ctx) => {
    const student = service.student(Number(ctx.match[1]));
    const origin = ctx.match[2]
      ? readOrigin(ctx.match[2])
      : { kind: 'c' as const, page: 0, groupId: selectedGroup(ctx.from!.id) };
    await ctx.answerCallbackQuery();
    await finishInput(ctx);
    if (student.currency !== 'UZS' || service.balance(student.id).debt === 0) {
      await show(ctx, studentPage(student, origin));
      return;
    }
    const intent: PayIntent = {
      kind: 'pay',
      studentId: student.id,
      token: randomBytes(8).toString('hex'),
      step: 'amount',
      origin,
      expires: Date.now() + 15 * 60_000,
    };
    pending.set(ctx.from!.id, intent);
    await show(ctx, amountPage(intent));
  });
  bot.callbackQuery(/^(pay|manual|amount|confirm):([a-f0-9]{16})(?::(\d+))?$/, async (ctx) => {
    const intent = state(ctx.from!.id);
    if (!intent || intent.kind !== 'pay' || intent.token !== ctx.match[2]) {
      await ctx.answerCallbackQuery({
        text: 'Форма устарела. Откройте оплату заново.',
        show_alert: true,
      });
      return;
    }
    payableStudent(intent.studentId);
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'confirm') {
      if (intent.step !== 'confirm' || intent.amount === undefined)
        throw new AppError(400, 'Сначала выберите и проверьте сумму.');
      await pay(
        ctx,
        intent.studentId,
        intent.amount,
        `intent:${intent.token}`,
        intent.origin,
        intent.date,
      );
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      return;
    }
    if (ctx.match[1] === 'amount') {
      const next = moveIntent(ctx.from!.id, intent, 'amount');
      await show(ctx, amountPage(next));
      return;
    }
    if (ctx.match[1] === 'manual') {
      const next = moveIntent(ctx.from!.id, intent, 'manual');
      await show(ctx, {
        text: rich(
          '✎ Введите сумму',
          block(
            `<b>${short(service.student(intent.studentId).name, 60)}</b>`,
            `Остаток: <code>${formatMoney(service.balance(intent.studentId).debt)}</code>`,
          ),
          'Отправьте целую сумму в сумах, например <code>250 000</code>. После ввода появится подтверждение.',
        ),
        keyboard: mainButton(
          new InlineKeyboard()
            .text('‹ К суммам', `amount:${next.token}`)
            .text('✕ Отмена', 'nav:cancel'),
        ),
      });
      return;
    }
    if (intent.step !== 'amount') throw new AppError(400, 'Вернитесь к выбору суммы.');
    await review(ctx, intent, Number(ctx.match[3]));
  });
  bot.callbackQuery(/^(?:admin:|admins:)/, async (ctx) => {
    if (!service.isOwner(ctx.from!.id)) {
      await ctx.answerCallbackQuery({ text: 'Только для владельца', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const data = ctx.callbackQuery.data;
    if (data === 'admin:next:arm' || data === 'admin:next:off') {
      await finishInput(ctx);
      if (data === 'admin:next:arm') service.armNextAdmin(ctx.from!.id);
      else service.cancelNextAdmin(ctx.from!.id);
      await show(ctx, adminPage());
      return;
    }
    if (data === 'admin:add') {
      await finishInput(ctx);
      const requestId = randomInt(1, 2_000_000_000);
      pending.set(ctx.from!.id, { kind: 'admin', requestId, expires: Date.now() + 15 * 60_000 });
      const keyboard = new Keyboard()
        .requestUsers('＋ Выбрать пользователя', requestId, { user_is_bot: false, max_quantity: 1 })
        .row()
        .text(ADMIN_BACK)
        .text(CANCEL)
        .resized()
        .oneTime();
      await ctx.reply(
        rich(
          '＋ Новый администратор',
          block(
            'Выберите пользователя кнопкой под полем ввода.',
            'Запасной путь: числовой Telegram ID или пересылка сообщения.',
          ),
          'Если автор пересылки скрыт, введите ID. Кнопки ниже позволяют вернуться или отменить ввод.',
        ),
        { ...htmlOptions, reply_markup: keyboard },
      );
      return;
    }
    await finishInput(ctx);
    if (/^admin:ask:\d+$/.test(data)) {
      const id = Number(data.split(':')[2]);
      if (service.isOwner(id)) throw new AppError(400, 'Владельца удалить нельзя.');
      await show(ctx, {
        text: rich(
          '⚠️ Отозвать доступ?',
          block(
            `Telegram ID: <code>${id}</code>`,
            'Пользователь больше не сможет просматривать учёт и вносить оплаты.',
          ),
          'Данные учеников и история оплат сохранятся.',
        ),
        keyboard: mainButton(
          new InlineKeyboard()
            .text('Удалить доступ', `admin:remove:${id}`)
            .danger()
            .text('Отмена', 'admins:0')
            .row()
            .text('‹ Администраторы', 'admins:0'),
        ),
      });
      return;
    }
    if (/^admin:remove:\d+$/.test(data)) {
      const id = Number(data.split(':')[2]);
      service.removeAdmin(ctx.from!.id, id);
      pending.delete(id);
      selectedGroups.delete(id);
      try {
        await bot.api.deleteMyCommands({ scope: { type: 'chat', chat_id: id } });
      } catch {
        console.warn('Не удалось убрать старое меню; права уже отозваны.');
      }
    }
    await show(ctx, adminPage(/^admins:\d+$/.test(data) ? Number(data.split(':')[1]) : 0));
  });
  async function addAdmin(ctx: Context, id: number) {
    service.addAdmin(ctx.from!.id, id);
    pending.delete(ctx.from!.id);
    await syncMenu(id);
    await ctx.reply(
      rich(
        '✅ Администратор добавлен',
        block(
          `Telegram ID: <code>${id}</code>`,
          'Доступ к учёту открыт. Пользователь может отправить /start.',
        ),
      ),
      { ...htmlOptions, reply_markup: { remove_keyboard: true } },
    );
    await send(ctx, adminPage());
  }
  bot.on('message:users_shared', async (ctx) => {
    const intent = state(ctx.from!.id);
    if (
      !intent ||
      intent.kind !== 'admin' ||
      intent.requestId !== ctx.message.users_shared.request_id
    ) {
      await send(ctx, {
        text: rich('⌛ Выбор устарел', 'Откройте добавление администратора заново.'),
        keyboard: mainButton(
          service.isOwner(ctx.from!.id)
            ? new InlineKeyboard().text('⚙ Администраторы', 'nav:admins')
            : new InlineKeyboard(),
        ),
      });
      return;
    }
    const user = ctx.message.users_shared.users[0];
    if (user) await addAdmin(ctx, user.user_id);
  });
  bot.on('message', async (ctx) => {
    const text = ctx.message.text?.trim();
    if (text === ADMIN_BACK || text === CANCEL) {
      await ctx.reply(rich('↩️ Ввод отменён', 'Выберите следующее действие.'), {
        ...htmlOptions,
        reply_markup: { remove_keyboard: true },
      });
      pending.delete(ctx.from!.id);
      await send(
        ctx,
        text === ADMIN_BACK && service.isOwner(ctx.from!.id) ? adminPage() : homePage(ctx),
      );
      return;
    }
    const intent = state(ctx.from!.id);
    if (!intent) {
      await send(ctx, {
        text: rich('🧭 Выберите действие', 'Все основные действия доступны кнопками.'),
        keyboard: menu(ctx.from!.id),
      });
      return;
    }
    if (intent.kind === 'admin') {
      const origin = ctx.message.forward_origin;
      if (origin?.type === 'user') {
        await addAdmin(ctx, origin.sender_user.id);
        return;
      }
      if (text && /^\d+$/.test(text)) {
        await addAdmin(ctx, Number(text));
        return;
      }
      await send(ctx, {
        text: rich(
          '⚠️ Не удалось получить ID',
          block(
            'Введите числовой ID или используйте кнопку выбора пользователя.',
            'У скрытой пересылки Telegram не сообщает ID автора.',
          ),
        ),
        keyboard: mainButton(
          new InlineKeyboard()
            .text('‹ Администраторы', 'nav:admins')
            .text('✕ Отмена', 'nav:cancel'),
        ),
      });
      return;
    }
    if (intent.step === 'manual' && text) {
      payableStudent(intent.studentId);
      await review(ctx, intent, parseAmount(text, 'UZS'));
      return;
    }
    await send(ctx, {
      text: rich(
        '🧭 Продолжите оплату',
        'Выберите сумму кнопкой либо вернитесь к предыдущему шагу.',
      ),
      keyboard: recovery(ctx),
    });
  });
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({
      text: 'Кнопка устарела. Откройте главное меню: /start.',
      show_alert: true,
    });
  });
  bot.catch(async ({ ctx, error }) => {
    console.error(
      'Ошибка бота:',
      error instanceof GrammyError
        ? `${error.error_code}: ${error.description}`
        : 'сеть или внутренняя ошибка',
    );
    try {
      if (ctx.chat)
        await send(ctx, {
          text: rich(
            '⚠️ Действие не завершено',
            'Проверьте результат в списке должников и повторите при необходимости.',
            'Если это была оплата, сначала проверьте остаток — не вводите её повторно вслепую.',
          ),
          keyboard:
            ctx.from && service.canAccess(ctx.from.id) && ctx.chat.type === 'private'
              ? mainButton(new InlineKeyboard().text('◷ Проверить долги', 'nav:debt'))
              : menu(ctx.from?.id ?? 0, false),
        });
    } catch {
      /* Telegram may be unavailable. */
    }
  });
  return {
    bot,
    async stop() {
      stopped = true;
      if (bot.isRunning()) await bot.stop();
    },
    async start() {
      await bot.init();
      if (stopped) return;
      const webhook = await bot.api.getWebhookInfo();
      if (webhook.url)
        throw new Error(
          'У бота настроен webhook. Он не изменён: отключите его перед long polling.',
        );
      if (stopped) return;
      await bot.api.setMyCommands(publicCommands);
      for (const id of new Set([
        service.ownerId,
        ...service.admins().map((admin) => admin.telegramId),
      ]))
        if (id) await syncMenu(id);
      if (stopped) return;
      console.log(`Telegram: @${bot.botInfo.username}, grammY 1.46, long polling`);
      await bot.start({
        allowed_updates: ['message', 'callback_query'],
        onStart: () => console.log('Telegram polling запущен'),
      });
    },
  };
}
