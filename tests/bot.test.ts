import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { createBot } from '../src/bot/index.js';

let db: Database.Database;
let service: LedgerService;
let bot: ReturnType<typeof createBot>['bot'];
let calls: { method: string; payload: Record<string, unknown> }[];
const owner = 123;
const outsider = 456;
let updateId = 1;
function message(userId: number, text: string): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1792411200,
      from: { id: userId, is_bot: false, first_name: 'Test' },
      chat: { id: userId, type: 'private', first_name: 'Test' },
      text,
      entities: text.startsWith('/')
        ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }]
        : [],
    },
  };
}
function callback(userId: number, data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: userId, is_bot: false, first_name: 'Test' },
      chat_instance: 'test',
      data,
      message: {
        message_id: 77,
        date: 1792411200,
        chat: { id: userId, type: 'private', first_name: 'Test' },
      },
    },
  };
}
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db, owner);
  bot = createBot('12345:unit-test-not-a-real-credential', service).bot;
  bot.botInfo = {
    id: 12345,
    is_bot: true,
    first_name: 'Test bot',
    username: 'test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
  calls = [];
  bot.api.config.use(async (previous, method, payload) => {
    calls.push({ method, payload: { ...payload } });
    const result =
      method === 'sendMessage' || method === 'editMessageText'
        ? {
            message_id: 77,
            date: 1792411200,
            chat: { id: owner, type: 'private', first_name: 'Test' },
            text: 'Mock Telegram response',
          }
        : true;
    // The mock transport responds only to methods used by these scenarios.
    return { ok: true, result } as Awaited<ReturnType<typeof previous<typeof method>>>;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  db.close();
});
describe('Telegram handlers with mocked API transport', () => {
  it('приветствует гостя и показывает его ID моноширинным текстом', async () => {
    await bot.handleUpdate(message(outsider, '/start'));
    const reply = calls.find((call) => call.method === 'sendMessage');
    expect(reply?.payload.parse_mode).toBe('HTML');
    expect(reply?.payload.text).toContain('Привет, Test!');
    expect(reply?.payload.text).toContain(`<code>${outsider}</code>`);
    expect(reply?.payload.text).toContain('Гость');
    expect(reply?.payload.text).toContain('передай владельцу');
    expect(service.canAccess(outsider)).toBe(false);
    expect(
      JSON.stringify(calls.find((call) => call.method === 'setMyCommands')?.payload),
    ).not.toContain('"command":"pay"');
  });
  it('приветствует владельца с ID, ролью и доступными командами', async () => {
    await bot.handleUpdate(message(owner, '/start'));
    const text = String(calls.find((call) => call.method === 'sendMessage')?.payload.text);
    expect(text).toContain(`<code>${owner}</code>`);
    expect(text).toContain('Владелец');
    expect(
      JSON.stringify(calls.find((call) => call.method === 'sendMessage')?.payload.reply_markup),
    ).toContain('nav:pay');
  });
  it('экранирует имя в публичном приветствии', async () => {
    const update = message(outsider, '/start');
    if ('message' in update && update.message?.from)
      update.message.from.first_name = '<b>Guest</b>';
    await bot.handleUpdate(update);
    expect(String(calls.find((call) => call.method === 'sendMessage')?.payload.text)).toContain(
      '&lt;b&gt;Guest&lt;/b&gt;',
    );
  });
  it('неавторизованный пользователь не может внести оплату', async () => {
    const student = service.createStudent({
      name: 'Test',
      phone: '+998901234567',
      group: 'A2',
      monthlyAmount: 500000,
    });
    await bot.handleUpdate(message(outsider, `/pay ${student.id} 100000`));
    expect(service.payments(student.id)).toHaveLength(0);
    expect(calls.find((call) => call.method === 'sendMessage')?.payload.text).toContain(
      'только владельцу',
    );
  });
  it('повторный /pay update не дублирует оплату', async () => {
    const student = service.createStudent({
      name: 'Test',
      phone: '+998901234567',
      group: 'A2',
      monthlyAmount: 500000,
    });
    const update = message(owner, `/pay ${student.id} 100000`);
    await bot.handleUpdate(update);
    await bot.handleUpdate(update);
    expect(service.payments(student.id)).toHaveLength(1);
    expect(calls.find((call) => call.method === 'sendMessage')?.payload.parse_mode).toBe('HTML');
  });
  it('не принимает переплату через команду бота', async () => {
    const student = service.createStudent({
      name: 'Test',
      phone: '+998901234567',
      group: 'A2',
      monthlyAmount: 500000,
    });
    await bot.handleUpdate(message(owner, `/pay ${student.id} 500001`));
    expect(service.payments(student.id)).toHaveLength(0);
    expect(
      calls.some(
        (call) =>
          call.method === 'sendMessage' &&
          String(call.payload.text).includes('превышает остаток долга'),
      ),
    ).toBe(true);
  });
  it('обычный администратор не может открыть /admins и owner callback', async () => {
    service.addAdmin(owner, outsider);
    await bot.handleUpdate(message(outsider, '/admins'));
    await bot.handleUpdate(callback(outsider, 'admin:add'));
    expect(
      calls.some(
        (call) =>
          call.method === 'sendMessage' && String(call.payload.text).includes('только владелец'),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) => call.method === 'answerCallbackQuery' && call.payload.show_alert === true,
      ),
    ).toBe(true);
  });
  it('долг редактируется в том же сообщении; HTML имён экранируется', async () => {
    service.createStudent({
      name: '<b>Test</b>',
      phone: '+998901234567',
      group: 'A2',
      monthlyAmount: 500000,
    });
    await bot.handleUpdate(callback(owner, 'debt:2026-10:0'));
    const edit = calls.find((call) => call.method === 'editMessageText');
    expect(edit?.payload.message_id).toBe(77);
    expect(edit?.payload.text).toContain('&lt;b&gt;Test&lt;/b&gt;');
    expect(JSON.stringify(edit?.payload.reply_markup)).toContain('"style":"primary"');
  });
  it('владелец добавляет числовой ID, а удаление требует подтверждения', async () => {
    await bot.handleUpdate(callback(owner, 'admin:add'));
    expect(
      JSON.stringify(calls.find((call) => call.method === 'sendMessage')?.payload.reply_markup),
    ).toContain('request_users');
    await bot.handleUpdate(message(owner, '789'));
    expect(service.canAccess(789)).toBe(true);
    await bot.handleUpdate(callback(owner, 'admin:ask:789'));
    expect(service.canAccess(789)).toBe(true);
    await bot.handleUpdate(callback(owner, 'admin:remove:789'));
    expect(service.canAccess(789)).toBe(false);
  });
});

it('запрещает USD в боте, сохраняет просмотр валют и не ограничивает общий сервис', async () => {
  const usd = service.createCourse({ name: 'USD', currency: 'USD', monthlyAmount: 12550 });
  const student = service.createStudent({
    name: 'Dollar student',
    phone: '+998901234567',
    courseId: usd.id,
  });
  service.createStudent({
    name: 'Sum student',
    phone: '+998901234567',
    group: 'UZS',
    monthlyAmount: 100000,
  });
  await bot.handleUpdate(message(owner, `/pay ${student.id} 25,25`));
  expect(service.payments(student.id)).toHaveLength(0);
  expect(
    String([...calls].reverse().find((call) => call.method === 'sendMessage')?.payload.text),
  ).toContain('только в сумах');
  const { today } = await import('../src/calendar');
  service.addPayment(student.id, { amount: 2525, date: today() });
  await bot.handleUpdate(message(owner, '/debt'));
  const text = String(
    [...calls].reverse().find((call) => call.method === 'sendMessage')?.payload.text,
  );
  expect(text).toContain('100,25 $');
  expect(text).toContain('100 000 сум');
  expect(text).not.toContain('110 025');
});

it('публичная /about называет автора и не раскрывает справочники гостю', async () => {
  service.createCourse({ name: 'Private course', monthlyAmount: 100000 });
  await bot.handleUpdate(message(outsider, '/about'));
  const text = String(calls.find((call) => call.method === 'sendMessage')?.payload.text);
  expect(text).toContain('Abdulloh Ergashev');
  expect(text).toMatch(/v\d+\.\d+\.\d+/);
  expect(text).not.toContain('Private course');
  await bot.handleUpdate(message(outsider, '/groups'));
  expect(String(calls.at(-1)?.payload.text)).toContain('только владельцу');
});

it('выбор группы ограничивает должников, учеников и пошаговую оплату', async () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 100000 });
  const morning = service.createGroup({ name: 'Morning', courseId: course.id });
  const evening = service.createGroup({ name: 'Evening', courseId: course.id });
  service.createStudent({ name: 'Alice', phone: '+998901234567', groupId: morning.id });
  service.createStudent({ name: 'Bob', phone: '+998901234568', groupId: evening.id });
  await bot.handleUpdate(callback(owner, `group:${morning.id}`));
  expect(String(calls.at(-1)?.payload.text)).toContain('Morning');
  expect(String(calls.at(-1)?.payload.text)).toContain('English');
  for (const command of ['/debt', '/students', '/pay']) {
    await bot.handleUpdate(message(owner, command));
    const text = String(calls.at(-1)?.payload.text);
    expect(text).toContain('Alice');
    expect(text).not.toContain('Bob');
    expect(text).toContain('English');
  }
  expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain('student:');
});

it('выбор группы личный; удалённая группа сбрасывает фильтр, старые кнопки получают понятную ошибку', async () => {
  service.addAdmin(owner, outsider);
  const course = service.createCourse({ name: 'English', monthlyAmount: 100000 });
  const first = service.createGroup({ name: 'First', courseId: course.id });
  const second = service.createGroup({ name: 'Second', courseId: course.id });
  service.createStudent({ name: 'Alice', phone: '+998901234567', groupId: first.id });
  service.createStudent({ name: 'Bob', phone: '+998901234568', groupId: second.id });
  await bot.handleUpdate(callback(owner, `group:${first.id}`));
  await bot.handleUpdate(message(outsider, '/students'));
  expect(String(calls.at(-1)?.payload.text)).toContain('Alice');
  expect(String(calls.at(-1)?.payload.text)).toContain('Bob');
  service.deleteGroup(first.id);
  await bot.handleUpdate(message(owner, '/students'));
  expect(String(calls.at(-1)?.payload.text)).toContain('Bob');
  await bot.handleUpdate(callback(owner, `group:${first.id}`));
  expect(String(calls.at(-1)?.payload.text)).toContain('Группа не найдена');
});

it('пагинация и переход месяца сохраняют группу, будущий месяц показывает прочерк', async () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 100000 });
  const group = service.createGroup({ name: 'Morning', courseId: course.id });
  for (let index = 0; index < 8; index++)
    service.createStudent({ name: `Student ${index}`, phone: '+998901234567', groupId: group.id });
  const { currentMonth, shiftMonth } = await import('../src/calendar');
  await bot.handleUpdate(callback(owner, `group:${group.id}`));
  await bot.handleUpdate(message(owner, '/debt'));
  expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(
    `debt:${currentMonth()}:1:${group.id}`,
  );
  await bot.handleUpdate(callback(owner, `debt:${currentMonth()}:1:${group.id}`));
  expect(String(calls.at(-1)?.payload.text)).toContain('Страница 2/2');
  await bot.handleUpdate(callback(owner, `debt:${shiftMonth(currentMonth(), 1)}:0:${group.id}`));
  expect(String(calls.at(-1)?.payload.text)).toContain('Месяц ещё не начался');
  expect(String(calls.at(-1)?.payload.text)).toContain('Итого: <code>—</code>');
  await bot.handleUpdate(message(owner, '/students'));
  expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(`students:1:${group.id}`);
});

it('бот показывает исторический тариф текущего месяца после правки курса, включая пустые группы', async () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 100000 });
  const group = service.createGroup({ name: 'Morning', courseId: course.id });
  service.updateCourse(course.id, { monthlyAmount: 200000 });
  await bot.handleUpdate(message(owner, '/groups'));
  expect(String(calls.at(-1)?.payload.text)).toContain('100 000 сум');
  expect(String(calls.at(-1)?.payload.text)).not.toContain('200 000 сум');
  service.createStudent({ name: 'Alice', phone: '+998901234567', groupId: group.id });
  await bot.handleUpdate(message(owner, '/students'));
  expect(String(calls.at(-1)?.payload.text)).toContain('100 000 сум');
  expect(String(calls.at(-1)?.payload.text)).not.toContain('200 000 сум');
});

it('USD-карточка доступна для просмотра, оплата командой заблокирована', async () => {
  const course = service.createCourse({
    name: 'English USD',
    currency: 'USD',
    monthlyAmount: 12550,
  });
  const group = service.createGroup({ name: 'Evening', courseId: course.id });
  const student = service.createStudent({
    name: 'Alice',
    phone: '+998901234567',
    groupId: group.id,
  });
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  expect(String(calls.at(-1)?.payload.text)).toContain('Evening');
  expect(String(calls.at(-1)?.payload.text)).toContain('English USD');
  expect(String(calls.at(-1)?.payload.text)).toContain('125,50 $');
  await bot.handleUpdate(message(owner, `/pay ${student.id} 25,25`));
  const text = String(calls.at(-1)?.payload.text);
  expect(text).toContain('только в сумах');
  expect(text).toContain('на сайте');
  expect(service.payments(student.id)).toHaveLength(0);
});

it('полностью оплатившему ученику не предлагает новую оплату', async () => {
  const student = service.createStudent({
    name: 'Alice',
    phone: '+998901234567',
    group: 'A2',
    monthlyAmount: 100000,
  });
  const { today } = await import('../src/calendar');
  service.addPayment(student.id, { amount: 100000, date: today() });
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  expect(String(calls.at(-1)?.payload.text)).toContain('всё оплачено');
  expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).not.toContain('manual:');
});

it('длинные HTML-имена в справочниках экранируются и не превышают лимит сообщения', async () => {
  const course = service.createCourse({ name: '"'.repeat(80), monthlyAmount: 100000 });
  for (let index = 0; index < 6; index++) {
    const group = service.createGroup({ name: '"'.repeat(79) + index, courseId: course.id });
    service.createStudent({ name: '"'.repeat(100), phone: '+998901234567', groupId: group.id });
  }
  for (const command of ['/groups', '/students', '/debt']) {
    await bot.handleUpdate(message(owner, command));
    const text = String(calls.at(-1)?.payload.text);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('&quot;');
  }
});

const keyboardSchema = z.object({
  inline_keyboard: z.array(
    z.array(z.object({ text: z.string(), callback_data: z.string().optional() })),
  ),
});
function lastButtons() {
  const call = [...calls]
    .reverse()
    .find(
      (call) =>
        (call.method === 'sendMessage' || call.method === 'editMessageText') &&
        call.payload.reply_markup,
    );
  return keyboardSchema.parse(call?.payload.reply_markup).inline_keyboard.flat();
}
function action(prefix: string): string {
  const value = lastButtons().find((button) =>
    button.callback_data?.startsWith(prefix),
  )?.callback_data;
  expect(value, `Missing ${prefix} in ${JSON.stringify(lastButtons())}`).toBeDefined();
  return value!;
}
function sumStudent() {
  return service.createStudent({
    name: 'Alice',
    phone: '+998901234567',
    group: 'Morning',
    monthlyAmount: 500000,
  });
}
it('полный путь кнопками: меню, группа, ученик, сумма, подтверждение и квитанция', async () => {
  const student = sumStudent();
  await bot.handleUpdate(message(owner, '/start'));
  await bot.handleUpdate(callback(owner, action('nav:groups')));
  await bot.handleUpdate(callback(owner, action(`group:${student.groupId}`)));
  await bot.handleUpdate(callback(owner, action('view:students:')));
  await bot.handleUpdate(callback(owner, action(`profile:${student.id}:`)));
  await bot.handleUpdate(callback(owner, action(`student:${student.id}:`)));
  await bot.handleUpdate(callback(owner, action('pay:')));
  expect(service.payments(student.id)).toHaveLength(0);
  expect(String(calls.at(-1)?.payload.text)).toContain('Подтвердите оплату');
  const confirm = action('confirm:');
  await bot.handleUpdate(callback(owner, confirm));
  expect(service.payments(student.id)).toHaveLength(1);
  expect(calls.some((call) => String(call.payload.text).includes('Оплата внесена'))).toBe(true);
  await bot.handleUpdate(callback(owner, confirm));
  expect(service.payments(student.id)).toHaveLength(1);
  expect(calls.at(-1)?.payload.show_alert).toBe(true);
});
it('назад от подтверждения и отмена делают старую кнопку оплаты недействительной', async () => {
  const student = sumStudent();
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  await bot.handleUpdate(callback(owner, action('pay:')));
  const oldConfirm = action('confirm:');
  await bot.handleUpdate(callback(owner, action('amount:')));
  const freshPreset = action('pay:');
  await bot.handleUpdate(callback(owner, oldConfirm));
  expect(service.payments(student.id)).toHaveLength(0);
  await bot.handleUpdate(callback(owner, freshPreset));
  const newConfirm = action('confirm:');
  await bot.handleUpdate(callback(owner, action('nav:cancel')));
  await bot.handleUpdate(callback(owner, newConfirm));
  expect(service.payments(student.id)).toHaveLength(0);
});
it('ручная сумма проверяется, не записывается до подтверждения и позволяет вернуться', async () => {
  const student = sumStudent();
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  await bot.handleUpdate(callback(owner, action('manual:')));
  const back = action('amount:');
  for (const invalid of ['25,50', '500001', '0', '-1']) {
    await bot.handleUpdate(message(owner, invalid));
    expect(service.payments(student.id)).toHaveLength(0);
    expect(String(calls.at(-1)?.payload.text)).toContain('Проверьте действие');
  }
  await bot.handleUpdate(callback(owner, back));
  await bot.handleUpdate(callback(owner, action('manual:')));
  await bot.handleUpdate(message(owner, '250 000'));
  expect(service.payments(student.id)).toHaveLength(0);
  expect(String(calls.at(-1)?.payload.text)).toContain('250 000 сум');
  await bot.handleUpdate(callback(owner, action('confirm:')));
  expect(service.payments(student.id)).toHaveLength(1);
  expect(service.payments(student.id)[0]?.amount).toBe(250000);
});
it.each(['confirm', 'manual'] as const)(
  'смена валюты ученика на USD блокирует уже открытый шаг %s',
  async (step) => {
    const student = sumStudent();
    const usd = service.createCourse({ name: 'USD', currency: 'USD', monthlyAmount: 10000 });
    const group = service.createGroup({ name: 'USD group', courseId: usd.id });
    await bot.handleUpdate(callback(owner, `student:${student.id}`));
    if (step === 'confirm') await bot.handleUpdate(callback(owner, action('pay:')));
    else await bot.handleUpdate(callback(owner, action('manual:')));
    const confirm = step === 'confirm' ? action('confirm:') : undefined;
    service.updateStudent(student.id, { groupId: group.id });
    if (confirm) await bot.handleUpdate(callback(owner, confirm));
    else await bot.handleUpdate(message(owner, '1000'));
    expect(service.payments(student.id)).toHaveLength(0);
    expect(String(calls.at(-1)?.payload.text)).toContain('только в сумах');
  },
);
it('оплата показывает только UZS, USD-группа не имеет кнопки записи платежа', async () => {
  const uzs = sumStudent();
  const course = service.createCourse({ name: 'USD', currency: 'USD', monthlyAmount: 10000 });
  const group = service.createGroup({ name: 'Dollars', courseId: course.id });
  const usd = service.createStudent({
    name: 'Dollar student',
    phone: '+998901234567',
    groupId: group.id,
  });
  await bot.handleUpdate(message(owner, '/pay'));
  expect(String(calls.at(-1)?.payload.text)).toContain(uzs.name);
  expect(String(calls.at(-1)?.payload.text)).not.toContain(usd.name);
  await bot.handleUpdate(callback(owner, `group:${group.id}`));
  expect(lastButtons().some((button) => button.callback_data?.startsWith('view:pay:'))).toBe(false);
  await bot.handleUpdate(callback(owner, `student:${usd.id}`));
  expect(
    lastButtons().some((button) =>
      /^(pay|manual|student|confirm):/.test(button.callback_data ?? ''),
    ),
  ).toBe(false);
  for (const amount of ['1000', '25,50'])
    await bot.handleUpdate(message(owner, `/pay ${usd.id} ${amount}`));
  expect(service.payments(usd.id)).toHaveLength(0);
});
it('карточка и шаг суммы сохраняют месяц, страницу и группу для возврата', async () => {
  const student = sumStudent();
  for (let index = 0; index < 7; index++)
    service.createStudent({
      name: `Student ${index}`,
      phone: '+998901234567',
      groupId: student.groupId,
    });
  const back = `debt:2026-09:1:${student.groupId}`;
  await bot.handleUpdate(callback(owner, back));
  const profile = action('profile:');
  await bot.handleUpdate(callback(owner, profile));
  expect(lastButtons().some((button) => button.callback_data === back)).toBe(true);
  await bot.handleUpdate(callback(owner, action('student:')));
  expect(lastButtons().some((button) => button.callback_data === profile)).toBe(true);
  await bot.handleUpdate(callback(owner, profile));
  await bot.handleUpdate(callback(owner, back));
  expect(String(calls.at(-1)?.payload.text)).toContain('2026-09');
  expect(String(calls.at(-1)?.payload.text)).toContain('Страница 2/2');
});
it('гостю доступны кнопки профиля/помощи, подделанная финансовая кнопка запрещена', async () => {
  await bot.handleUpdate(message(outsider, '/start'));
  expect(lastButtons().some((button) => button.callback_data === 'nav:pay')).toBe(false);
  await bot.handleUpdate(callback(outsider, 'nav:help'));
  expect(String(calls.at(-1)?.payload.text)).toContain('Как пользоваться');
  await bot.handleUpdate(callback(outsider, 'nav:pay'));
  expect(calls.at(-1)?.method).toBe('answerCallbackQuery');
  expect(calls.at(-1)?.payload.show_alert).toBe(true);
});
it('администратор может вернуться с выбора пользователя кнопкой и отменённый ввод не выдаёт доступ', async () => {
  await bot.handleUpdate(callback(owner, 'admin:add'));
  const request = JSON.stringify(calls.at(-1)?.payload.reply_markup);
  expect(request).toContain('request_users');
  expect(request).toContain('К администраторам');
  await bot.handleUpdate(message(owner, '‹ К администраторам'));
  expect(String(calls.at(-1)?.payload.text)).toContain('Администраторы');
  expect(
    calls.some((call) =>
      String(JSON.stringify(call.payload.reply_markup)).includes('remove_keyboard'),
    ),
  ).toBe(true);
  await bot.handleUpdate(message(owner, '789'));
  expect(service.canAccess(789)).toBe(false);
});
it('устаревшее подтверждение через 15 минут не записывает оплату', async () => {
  const student = sumStudent();
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  await bot.handleUpdate(callback(owner, action('pay:')));
  const confirm = action('confirm:');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  await bot.handleUpdate(callback(owner, confirm));
  expect(service.payments(student.id)).toHaveLength(0);
  expect(calls.at(-1)?.payload.show_alert).toBe(true);
});
it('сообщения сценариев оформлены HTML, callback_data укладывается в Telegram 64 байта', async () => {
  const student = sumStudent();
  for (const text of ['/start', '/help', '/about', '/groups', '/students', '/debt'])
    await bot.handleUpdate(message(owner, text));
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  await bot.handleUpdate(callback(owner, action('manual:')));
  await bot.handleUpdate(message(owner, '0'));
  await bot.handleUpdate(message(owner, '100000'));
  await bot.handleUpdate(callback(owner, action('nav:cancel')));
  for (const call of calls.filter(
    (call) => call.method === 'sendMessage' || call.method === 'editMessageText',
  )) {
    expect(call.payload.parse_mode).toBe('HTML');
    expect(String(call.payload.text)).toContain('<b>');
    const parsed = keyboardSchema.safeParse(call.payload.reply_markup);
    if (parsed.success)
      for (const button of parsed.data.inline_keyboard.flat())
        if (button.callback_data)
          expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
  }
});

it('переход через полночь требует нового подтверждения даты без записи платежа', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T18:59:00Z'));
  const student = sumStudent();
  await bot.handleUpdate(callback(owner, `student:${student.id}`));
  await bot.handleUpdate(callback(owner, action('pay:')));
  const confirm = action('confirm:');
  expect(String(calls.at(-1)?.payload.text)).toContain('2026-10-20');
  vi.setSystemTime(new Date('2026-10-20T19:01:00Z'));
  await bot.handleUpdate(callback(owner, confirm));
  expect(service.payments(student.id)).toHaveLength(0);
  expect(String(calls.at(-1)?.payload.text)).toContain('Дата изменилась');
});
