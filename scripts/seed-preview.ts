import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { AccountService } from '../src/services/accounts.js';
import { currentMonth, shiftMonth, today } from '../src/calendar.js';
if (config.stage !== 'preview' || config.botToken)
  throw new Error('Демонстрация запускается только в preview без Telegram-токена');
if (!config.webAuth)
  throw new Error('Сначала задайте WEB_USERNAME и WEB_PASSWORD для владельца preview в .env');
const db = openDatabase(config.dbPath);
try {
  const ledger = new LedgerService(db, config.ownerId),
    accounts = new AccountService(db);
  if (ledger.courses().length || ledger.students().length)
    throw new Error('Демонстрация заполняет только пустую preview-базу');
  const passwords = {
    teacher: randomBytes(12).toString('base64url'),
    admin: randomBytes(12).toString('base64url'),
  };
  db.transaction(() => {
    const owner = accounts.bootstrap(
      config.webAuth!.username,
      config.webAuth!.password,
      config.ownerId,
    );
    const course = ledger.createCourse({ name: 'English A2', monthlyAmount: 850000 });
    const math = ledger.createCourse({ name: 'Математика', monthlyAmount: 500000 });
    const usd = ledger.createCourse({ name: 'Frontend', currency: 'USD', monthlyAmount: 12550 });
    const group = ledger.createGroup({
      name: 'Утренняя',
      courseId: course.id,
      startsOn: currentMonth() + '-01',
    });
    const second = ledger.createGroup({
      name: 'Вечерняя',
      courseId: math.id,
      startsOn: currentMonth() + '-01',
    });
    const dollar = ledger.createGroup({
      name: 'Frontend · выходные',
      courseId: usd.id,
      startsOn: currentMonth() + '-01',
    });
    const future = ledger.createGroup({
      name: 'Новая группа',
      courseId: course.id,
      startsOn: shiftMonth(currentMonth(), 1) + '-01',
    });
    const a = ledger.createStudent({
      name: 'Азиза Каримова',
      phone: '+998901234567',
      groupId: group.id,
      enrolledOn: group.startsOn!,
    });
    ledger.createStudent({
      name: 'Тимур Рахимов',
      phone: '+998931234567',
      groupId: group.id,
      enrolledOn: group.startsOn!,
    });
    const b = ledger.createStudent({
      name: 'Мадина Юсупова',
      phone: '+998911234567',
      groupId: second.id,
      enrolledOn: second.startsOn!,
    });
    const c = ledger.createStudent({
      name: 'Бобур Алиев',
      phone: '+998971234567',
      groupId: dollar.id,
      enrolledOn: dollar.startsOn!,
    });
    const d = ledger.createStudent({
      name: 'Саид Саидов',
      phone: '+998991234567',
      groupId: future.id,
      enrolledOn: future.startsOn!,
    });
    ledger.addPayment(a.id, { amount: 350000, date: today(), billingMonth: currentMonth() });
    ledger.addPayment(a.id, {
      amount: 850000,
      date: today(),
      billingMonth: shiftMonth(currentMonth(), 1),
    });
    ledger.addPayment(b.id, { amount: 500000, date: today() });
    ledger.addPayment(c.id, { amount: 2550, date: today() });
    ledger.addPayment(d.id, {
      amount: 100000,
      date: today(),
      billingMonth: shiftMonth(currentMonth(), 1),
    });
    accounts.create(owner.id, {
      username: 'demo-teacher',
      name: 'Демо-учитель',
      password: passwords.teacher,
      role: 'teacher',
      groupIds: [group.id, future.id],
    });
    accounts.create(owner.id, {
      username: 'demo-admin',
      name: 'Демо-администратор',
      password: passwords.admin,
      role: 'admin',
    });
  }).immediate();
  console.log('Созданы только вымышленные preview-данные. Рабочий бот не запускается.');
  console.log('При первом входе сотрудникам нужно сменить временный пароль.');
  console.log('demo-teacher: ' + passwords.teacher);
  console.log('demo-admin: ' + passwords.admin);
} finally {
  db.close();
}
