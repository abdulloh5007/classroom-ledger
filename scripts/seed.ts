import { config } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { today } from '../src/calendar.js';

const db = openDatabase(config.dbPath);
try {
  const service = new LedgerService(db, config.ownerId);
  if (service.students().length)
    console.log('База уже содержит учеников. Демо-данные не добавлены.');
  else
    db.transaction(() => {
      const examples = [
        {
          name: 'Азиза Каримова',
          phone: '+998 90 123 45 67',
          group: 'English · A2',
          monthlyAmount: 850000,
          paid: 350000,
        },
        {
          name: 'Тимур Рахимов',
          phone: '+998 93 456 78 90',
          group: 'Frontend · 04',
          monthlyAmount: 1200000,
          paid: 800000,
        },
        {
          name: 'Мадина Юсупова',
          phone: '+998 91 222 33 44',
          group: 'English · B1',
          monthlyAmount: 650000,
          paid: 400000,
        },
        {
          name: 'Бобур Алиев',
          phone: '+998 97 555 12 34',
          group: 'Математика · 02',
          monthlyAmount: 500000,
          paid: 500000,
        },
      ];
      for (const { paid, ...input } of examples) {
        const student = service.createStudent(input);
        service.addPayment(student.id, { amount: paid, date: today() });
      }
      console.log('Добавлены 4 демонстрационных ученика и оплаты за текущий месяц.');
    })();
} finally {
  db.close();
}
