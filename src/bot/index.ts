import { randomBytes, randomInt } from 'node:crypto';
import { Bot, GrammyError, InlineKeyboard, Keyboard, type Context } from 'grammy';
import { ZodError } from 'zod';
import { currentMonth, formatMoney, shiftMonth, today } from '../calendar.js';
import { AppError } from '../errors.js';
import { LedgerService, parseAmount } from '../services/ledger.js';

const html = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const short = (value: string, size = 60): string => html(value.slice(0, size));
const publicCommands = [
  { command: 'start', description: 'Приветствие и мой Telegram ID' },
  { command: 'help', description: 'Как пользоваться ботом' },
];
const commands = [
  { command: 'start', description: 'Открыть учёт оплат' },
  { command: 'help', description: 'Справка' },
  { command: 'debt', description: 'Должники по месяцам' },
  { command: 'pay', description: 'Внести оплату' },
  { command: 'students', description: 'Список учеников' },
  { command: 'cancel', description: 'Отменить ввод' },
];
type Pending = { expires: number } & (
  | { kind: 'admin'; requestId: number }
  | { kind: 'pay'; studentId: number; token: string; manual: boolean }
);

export function createBot(token: string, service: LedgerService) {
  const bot = new Bot(token, { client: { timeoutSeconds: 35 } });
  const pending = new Map<number, Pending>();
  let stopped = false;
  const htmlOptions = { parse_mode: 'HTML' } as const;
  const state = (id: number): Pending | undefined => {
    const value = pending.get(id);
    if (value && value.expires > Date.now()) return value;
    pending.delete(id);
    return undefined;
  };
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
  // This error boundary also covers public commands.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof ZodError || error instanceof AppError) {
        await ctx.reply(
          error instanceof ZodError
            ? `Проверьте ввод: ${error.issues.map((issue) => issue.message).join('; ')}`
            : error.message,
        );
        return;
      }
      throw error;
    }
  });
  const help =
    '<b>Что можно сделать</b>\n\n/debt — задолженность по месяцам\n/pay — внести оплату по шагам\n/pay <code>12 250000</code> — быстрая оплата\n/students — ученики и их ID\n/cancel — отменить ввод\n\n<blockquote>Суммы — целые, в сумах. Дата определяется по времени Ташкента.</blockquote>';
  // Welcome and identification are public. Financial handlers remain behind the access guard.
  bot.command(['start', 'help'], async (ctx) => {
    const user = ctx.from;
    if (!user) return;
    pending.delete(user.id);
    const allowed = service.canAccess(user.id);
    const role = service.isOwner(user.id) ? 'Владелец' : allowed ? 'Администратор' : 'Гость';
    const name = html([user.first_name, user.last_name].filter(Boolean).join(' '));
    const profile = `<b>Привет, ${html(user.first_name)}! 👋</b>\nДобро пожаловать в <b>Класс</b> — учёт оплат учебного центра.\n\n<blockquote><b>Твой профиль</b>\nИмя: <b>${name}</b>\nTelegram ID: <code>${user.id}</code>\nРоль: <b>${role}</b></blockquote>`;
    if (ctx.chat.type === 'private') await syncMenu(user.id);
    const instructions = allowed
      ? `Доступ к учёту оплат открыт.\n\n${help}`
      : 'Чтобы получить доступ, передай владельцу свой Telegram ID. Нажми на ID выше, чтобы скопировать его.\n\n<tg-spoiler>Ученики и оплаты видны только владельцу и администраторам.</tg-spoiler>';
    await ctx.reply(
      `${profile}\n\n${instructions}${ctx.chat.type !== 'private' ? '\n\nДля работы открой личный чат с ботом.' : ''}`,
      { ...htmlOptions, reply_markup: { remove_keyboard: true } },
    );
  });
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id || !service.canAccess(id)) {
      if (ctx.callbackQuery)
        await ctx.answerCallbackQuery({ text: 'Доступ только для сотрудников', show_alert: true });
      else if (ctx.chat)
        await ctx.reply(
          `Доступ к учёту оплат разрешён только владельцу и администраторам.\n\nТвой Telegram ID: <code>${id ?? 'не определён'}</code>\nОтправь /start, чтобы узнать, как получить доступ.`,
          htmlOptions,
        );
      return;
    }
    if (ctx.chat?.type !== 'private') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Откройте личный чат с ботом' });
      else await ctx.reply('Для работы с оплатами откройте личный чат с ботом.');
      return;
    }
    await next();
  });
  bot.command('cancel', async (ctx) => {
    pending.delete(ctx.from!.id);
    await ctx.reply('Ввод отменён.', { reply_markup: { remove_keyboard: true } });
  });

  function debtPage(month: string, rawPage = 0) {
    const rows = service.debtors(month);
    const pages = Math.max(1, Math.ceil(rows.length / 4));
    const page = Math.max(0, Math.min(rawPage, pages - 1));
    const entries = rows
      .slice(page * 4, page * 4 + 4)
      .map(
        (row) =>
          `<b>${short(row.name, 50)}</b> · <code>#${row.studentId}</code>\n${short(row.group, 30)} · оплачено <code>${formatMoney(row.paid, row.currency)}</code>\nДолг: <code>${formatMoney(row.debt, row.currency)}</code>`,
      )
      .join('\n\n');
    const keyboard = new InlineKeyboard();
    if (month !== '1900-01') keyboard.text('‹ Пред.', `debt:${shiftMonth(month, -1)}:0`).primary();
    if (month !== '9999-11') keyboard.text('След. ›', `debt:${shiftMonth(month, 1)}:0`).primary();
    if (pages > 1) {
      keyboard.row();
      if (page > 0) keyboard.text('↑ Назад', `debt:${month}:${page - 1}`);
      if (page < pages - 1) keyboard.text('Ещё ↓', `debt:${month}:${page + 1}`);
    }
    const totals =
      [...new Set(rows.map((row) => row.currency))]
        .map((currency) =>
          formatMoney(
            rows.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.debt, 0),
            currency,
          ),
        )
        .join(' + ') || formatMoney(0);
    return {
      text: `<b>Задолженность · ${month}</b>\n\n${entries ? `<blockquote expandable>${entries}</blockquote>` : '✓ Все оплаты внесены. Должников нет.'}\n\nИтого: <code>${totals}</code>\nУчеников: ${rows.length} · Страница ${page + 1}/${pages}`,
      reply_markup: keyboard,
    };
  }
  bot.command('debt', async (ctx) => {
    const page = debtPage(currentMonth());
    await ctx.reply(page.text, { ...htmlOptions, reply_markup: page.reply_markup });
  });
  bot.callbackQuery(/^debt:(\d{4}-\d{2}):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = debtPage(ctx.match[1]!, Number(ctx.match[2]));
    try {
      await ctx.editMessageText(page.text, { ...htmlOptions, reply_markup: page.reply_markup });
    } catch (error) {
      if (!(error instanceof GrammyError && error.description.includes('message is not modified')))
        throw error;
    }
  });
  function studentsPage(rawPage: number, choose: boolean) {
    const students = service.students();
    const page = Math.max(0, Math.min(rawPage, Math.max(0, Math.ceil(students.length / 6) - 1)));
    const selected = students.slice(page * 6, page * 6 + 6);
    const prefix = choose ? 'choose' : 'students';
    const keyboard = new InlineKeyboard();
    if (choose)
      for (const student of selected)
        keyboard
          .text(`${student.name.slice(0, 50)} · #${student.id}`, `student:${student.id}`)
          .primary()
          .row();
    if (page > 0) keyboard.text('‹ Назад', `${prefix}:${page - 1}`);
    if ((page + 1) * 6 < students.length) keyboard.text('Далее ›', `${prefix}:${page + 1}`);
    const list = selected
      .map(
        (student) =>
          `<code>#${student.id}</code> <b>${short(student.name)}</b>\n${short(student.group, 35)} · <code>${formatMoney(student.monthlyAmount, student.currency)}</code>`,
      )
      .join('\n\n');
    return {
      text: students.length
        ? `<b>${choose ? 'Выберите ученика' : 'Ученики'}</b>\n\n${list}\n\nВсего: ${students.length}`
        : 'Учеников пока нет. Добавьте первого в веб-интерфейсе.',
      keyboard,
    };
  }
  bot.command('students', async (ctx) => {
    const page = studentsPage(0, false);
    await ctx.reply(page.text, { ...htmlOptions, reply_markup: page.keyboard });
  });
  bot.callbackQuery(/^(students|choose):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const page = studentsPage(Number(ctx.match[2]), ctx.match[1] === 'choose');
    await ctx.editMessageText(page.text, { ...htmlOptions, reply_markup: page.keyboard });
  });
  async function pay(ctx: Context, studentId: number, amount: number, key: string) {
    const payment = service.addPayment(studentId, { amount, date: today() }, key);
    const student = service.student(payment.studentId);
    const { debt } = service.balance(student.id, payment.date.slice(0, 7));
    if (ctx.from) pending.delete(ctx.from!.id);
    await ctx.reply(
      `<b>✓ Оплата внесена</b>\n\n<blockquote><b>${short(student.name)}</b>\nID: <code>${student.id}</code>\nСумма: <code>${formatMoney(payment.amount, student.currency)}</code>\nДата: <code>${payment.date}</code>\nОстаток долга: <code>${formatMoney(debt, student.currency)}</code></blockquote>`,
      { ...htmlOptions, reply_markup: { remove_keyboard: true } },
    );
  }
  bot.command('pay', async (ctx) => {
    pending.delete(ctx.from!.id);
    if (ctx.match.trim()) {
      const match = /^(\d+)\s+([\d., \u00a0\u202f]+)$/.exec(ctx.match.trim());
      if (!match) {
        await ctx.reply('Формат: /pay 12 250000. Для выбора кнопками отправьте /pay.');
        return;
      }
      await pay(
        ctx,
        Number(match[1]),
        parseAmount(match[2]!, service.student(Number(match[1])).currency),
        `update:${ctx.update.update_id}`,
      );
      return;
    }
    const page = studentsPage(0, true);
    await ctx.reply(page.text, { ...htmlOptions, reply_markup: page.keyboard });
  });
  bot.callbackQuery(/^student:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const student = service.student(Number(ctx.match[1]));
    const { debt } = service.balance(student.id);
    const token = randomBytes(8).toString('hex');
    pending.set(ctx.from!.id, {
      kind: 'pay',
      studentId: student.id,
      token,
      manual: false,
      expires: Date.now() + 15 * 60_000,
    });
    const keyboard = new InlineKeyboard();
    for (const amount of new Set(
      [debt, ...(student.currency === 'USD' ? [1000, 2500] : [100000, 250000])].filter(
        (value) => value > 0 && value <= debt,
      ),
    ))
      keyboard
        .text(formatMoney(amount, student.currency), `pay:${token}:${amount}`)
        .success()
        .row();
    keyboard.text('✎ Ввести вручную', `manual:${token}`).primary();
    await ctx.editMessageText(
      `<b>${short(student.name)}</b>\nДолг за ${currentMonth()}: <code>${formatMoney(debt, student.currency)}</code>\n\nВыберите сумму — нажатие сразу внесёт оплату.`,
      { ...htmlOptions, reply_markup: keyboard },
    );
  });
  bot.callbackQuery(/^(pay|manual):([a-f0-9]{16})(?::(\d+))?$/, async (ctx) => {
    const intent = state(ctx.from!.id);
    if (!intent || intent.kind !== 'pay' || intent.token !== ctx.match[2]) {
      await ctx.answerCallbackQuery({
        text: 'Форма устарела. Начните заново: /pay',
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'manual') {
      pending.set(ctx.from!.id, { ...intent, manual: true });
      await ctx.reply(
        service.student(intent.studentId).currency === 'USD'
          ? 'Введите сумму в долларах, например 25,50. Отмена: /cancel.'
          : 'Введите целую сумму в сумах, например 250 000. Отмена: /cancel.',
      );
      return;
    }
    await pay(ctx, intent.studentId, Number(ctx.match[3]!), `intent:${intent.token}`);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  });

  function adminPage(rawPage = 0) {
    const admins = service.admins();
    const pages = Math.max(1, Math.ceil(admins.length / 10));
    const page = Math.max(0, Math.min(rawPage, pages - 1));
    const keyboard = new InlineKeyboard().text('➕ Добавить админа', 'admin:add').success().row();
    for (const admin of admins.slice(page * 10, page * 10 + 10))
      keyboard.text(`Удалить ${admin.telegramId}`, `admin:ask:${admin.telegramId}`).danger().row();
    if (page > 0) keyboard.text('‹ Назад', `admins:${page - 1}`);
    if (page < pages - 1) keyboard.text('Далее ›', `admins:${page + 1}`);
    return {
      text: `<b>Администраторы</b>\n\nВладелец: <code>${service.ownerId}</code>\n${
        admins
          .slice(page * 10, page * 10 + 10)
          .map((admin) => `• <code>${admin.telegramId}</code>`)
          .join('\n') || 'Дополнительных администраторов нет.'
      }\n\n<tg-spoiler>Только владелец может менять доступ.</tg-spoiler>\nСтраница ${page + 1}/${pages}`,
      keyboard,
    };
  }
  bot.command('admins', async (ctx) => {
    if (!service.isOwner(ctx.from!.id)) {
      await ctx.reply('Управлять администраторами может только владелец.');
      return;
    }
    pending.delete(ctx.from!.id);
    const page = adminPage();
    await ctx.reply(page.text, { ...htmlOptions, reply_markup: page.keyboard });
  });
  bot.callbackQuery(/^(?:admin:|admins:)/, async (ctx) => {
    if (!service.isOwner(ctx.from!.id)) {
      await ctx.answerCallbackQuery({ text: 'Только для владельца', show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const data = ctx.callbackQuery.data;
    if (data === 'admin:add') {
      const requestId = randomInt(1, 2_000_000_000);
      pending.set(ctx.from!.id, { kind: 'admin', requestId, expires: Date.now() + 15 * 60_000 });
      const keyboard = new Keyboard()
        .requestUsers('Выбрать пользователя', requestId, { user_is_bot: false, max_quantity: 1 })
        .resized()
        .oneTime();
      await ctx.reply(
        'Выберите пользователя кнопкой, введите его числовой Telegram ID или перешлите его сообщение. Если автор скрыт настройками приватности, нужен ID. Отмена: /cancel.',
        { reply_markup: keyboard },
      );
    } else if (data.startsWith('admin:ask:')) {
      const id = Number(data.split(':')[2]);
      await ctx.editMessageText(`Удалить администратора <code>${id}</code>?`, {
        ...htmlOptions,
        reply_markup: new InlineKeyboard()
          .text('Удалить', `admin:remove:${id}`)
          .danger()
          .text('Отмена', 'admins:0'),
      });
    } else {
      if (data.startsWith('admin:remove:')) {
        const id = Number(data.split(':')[2]);
        service.removeAdmin(ctx.from!.id, id);
        pending.delete(id);
        try {
          await bot.api.deleteMyCommands({ scope: { type: 'chat', chat_id: id } });
        } catch {
          console.warn('Не удалось убрать старое меню; права уже отозваны.');
        }
      }
      const page = adminPage(data.startsWith('admins:') ? Number(data.split(':')[1]) : 0);
      await ctx.editMessageText(page.text, { ...htmlOptions, reply_markup: page.keyboard });
    }
  });
  async function addAdmin(ctx: Context, id: number) {
    service.addAdmin(ctx.from!.id, id);
    pending.delete(ctx.from!.id);
    await syncMenu(id);
    await ctx.reply(`✓ Администратор <code>${id}</code> добавлен.`, {
      ...htmlOptions,
      reply_markup: { remove_keyboard: true },
    });
  }
  bot.on('message:users_shared', async (ctx) => {
    const intent = state(ctx.from!.id);
    if (
      !intent ||
      intent.kind !== 'admin' ||
      intent.requestId !== ctx.message.users_shared.request_id
    )
      return;
    const user = ctx.message.users_shared.users[0];
    if (user) await addAdmin(ctx, user.user_id);
  });
  bot.on('message', async (ctx) => {
    const intent = state(ctx.from!.id);
    if (!intent) {
      await ctx.reply('Выберите команду: /help.');
      return;
    }
    if (intent.kind === 'admin') {
      const origin = ctx.message.forward_origin;
      if (origin?.type === 'user') {
        await addAdmin(ctx, origin.sender_user.id);
        return;
      }
      const text = ctx.message.text?.trim();
      if (text && /^\d+$/.test(text)) {
        await addAdmin(ctx, Number(text));
        return;
      }
      await ctx.reply(
        'Не удалось получить ID. Введите числовой ID или используйте кнопку выбора пользователя.',
      );
    } else if (intent.manual && ctx.message.text)
      await pay(
        ctx,
        intent.studentId,
        parseAmount(ctx.message.text, service.student(intent.studentId).currency),
        `intent:${intent.token}`,
      );
    else await ctx.reply('Выберите сумму кнопкой либо начните заново: /pay.');
  });
  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Кнопка устарела. Используйте /help.' });
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
        await ctx.reply(
          'Не удалось выполнить действие. Проверьте результат через /debt и повторите при необходимости.',
        );
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
