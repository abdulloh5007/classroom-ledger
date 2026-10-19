import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
afterEach(() => db.close());
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
    expect(text).toContain('/pay');
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

it('принимает доллары в /pay, сохраняет целые центы и разделяет итог задолженности по валютам', async () => {
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
  expect(service.payments(student.id)[0]?.amount).toBe(2525);
  expect(
    String([...calls].reverse().find((call) => call.method === 'sendMessage')?.payload.text),
  ).toContain('25,25 $');
  await bot.handleUpdate(message(owner, '/debt'));
  const text = String(
    [...calls].reverse().find((call) => call.method === 'sendMessage')?.payload.text,
  );
  expect(text).toContain('100,25 $');
  expect(text).toContain('100 000 сум');
  expect(text).not.toContain('110 025');
});
