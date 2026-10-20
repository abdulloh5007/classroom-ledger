import type { Currency } from '../src/contracts';
import { currencyUnit, moneyNumber } from '../src/money';
import { useSyncExternalStore } from 'react';

export type Language = 'ru' | 'uz';
const uz: Record<string, string> = {
  'О проекте': 'Loyiha haqida',
  'Назад к созданию группы': 'Guruh yaratishga qaytish',
  'Текущий месяц': 'Joriy oy',
  'Показать всех': 'Barchasini ko‘rsatish',
  'Пояснение к оплате в месяц': 'Oylik to‘lov haqida izoh',
  'О стоимости курса': 'Kurs narxi haqida',
  'Изменить группу': 'Guruhni tahrirlash',
  'Группа обновлена': 'Guruh yangilandi',
  'Группа удалена': 'Guruh o‘chirildi',
  'Удалить группу': 'Guruhni o‘chirish',
  'Удалить всё': 'Hammasini o‘chirish',
  'Действия необратимы. Вы согласны?': 'Bu amalni qaytarib bo‘lmaydi. Rozimisiz?',
  'Новая стоимость действует со следующего месяца. История и тарифы прошлых месяцев сохраняются.':
    'Yangi narx keyingi oydan amal qiladi. Tarix va avvalgi oylar narxi saqlanadi.',
  'Изменения курса применяются ко всем его группам.':
    'Kursdagi o‘zgarishlar uning barcha guruhlariga qo‘llanadi.',
  'Группа, её ученики и оплаты будут удалены. Другие группы сохранятся.':
    'Guruh, uning o‘quvchilari va to‘lovlari o‘chiriladi. Boshqa guruhlar saqlanadi.',
  'Валюта курса': 'Kurs valyutasi',
  Создать: 'Yaratish',
  'Нельзя менять валюту курса с учениками':
    'O‘quvchilari bor kurs valyutasini o‘zgartirib bo‘lmaydi',
  'Нельзя переводить ученика с оплатами на курс в другой валюте':
    'To‘lovlari bor o‘quvchini boshqa valyutadagi kursga o‘tkazib bo‘lmaydi',
  'Меню группы': 'Guruh menyusi',
  'Создать группу': 'Guruh yaratish',
  'Сменить группу': 'Guruhni almashtirish',
  'Название группы': 'Guruh nomi',
  'Введите название группы': 'Guruh nomini kiriting',
  'Выберите группу': 'Guruhni tanlang',
  'Нет групп': 'Guruhlar yo‘q',
  'Группа создана': 'Guruh yaratildi',
  'Группа не найдена': 'Guruh topilmadi',
  'Такая группа уже существует': 'Bunday guruh mavjud',
  'Курс группы': 'Guruh kursi',
  'Все ученики группы учатся на одном курсе.':
    'Guruhdagi barcha o‘quvchilar bir xil kursda o‘qiydi.',
  'Сначала создайте группу и выберите для неё курс.':
    'Avval guruh yarating va uning kursini tanlang.',
  'Нельзя удалить курс с группами': 'Guruhlari bor kursni o‘chirib bo‘lmaydi',

  'После оплаты': 'To‘lovdan so‘ng',
  Останется: 'Qoladi',
  'Будущий месяц: данных пока нет': 'Kelgusi oy: hozircha ma’lumot yo‘q',
  'В процессе': 'Qisman to‘langan',
  'Введите логин': 'Loginni kiriting',
  'Введите номер полностью: +998 (90) 123-56-78': 'Raqamni to‘liq kiriting: +998 (90) 123-56-78',
  'Введите пароль': 'Parolni kiriting',
  'Вернуться наверх': 'Yuqoriga qaytish',
  'Включить светлую тему': 'Yorug‘ mavzuni yoqish',
  'Включить тёмную тему': 'Qorong‘i mavzuni yoqish',
  'Внесена часть суммы': 'Summaning bir qismi to‘langan',
  'Внести весь остаток': 'Qoldiqni to‘liq kiritish',
  'Внести оплату': 'To‘lov kiritish',
  Войти: 'Kirish',
  Все: 'Barchasi',
  'Все ученики': 'Barcha o‘quvchilar',
  'Все ученики за месяц': 'Oydagi barcha o‘quvchilar',
  'Всего внесено за всё время': 'Jami to‘langan',
  Вход: 'Kirish',
  'Входим…': 'Kirilmoqda…',
  'Вход · Класс': 'Kirish · Sinf',
  'Класс · Учёт оплат': 'Sinf · To‘lovlar hisobi',
  'Выберите другой статус оплаты с помощью фильтра.':
    'Filtr orqali boshqa to‘lov holatini tanlang.',
  'Выберите ученика': 'O‘quvchini tanlang',
  'Выбор месяца и года': 'Oy va yilni tanlash',
  'Выбрать дату': 'Sanani tanlash',
  'Выбрать месяц': 'Oyni tanlash',
  Выйти: 'Chiqish',
  Год: 'Yil',
  Готово: 'Tayyor',
  Группа: 'Guruh',
  'Данные и месячная стоимость обучения': 'Ma’lumotlar va oylik ta’lim narxi',
  'Данные появятся, когда наступит этот месяц.': 'Ushbu oy boshlanganda ma’lumotlar paydo bo‘ladi.',
  'Данные ученика обновлены': 'O‘quvchi ma’lumotlari yangilandi',
  'Дата оплаты': 'To‘lov sanasi',
  День: 'Kun',
  Добавить: 'Qo‘shish',
  'Добавить ученика': 'O‘quvchi qo‘shish',
  'Добавьте первого ученика и месячную стоимость обучения.':
    'Birinchi o‘quvchini va oylik ta’lim narxini kiriting.',
  'Добавьте первого ученика, чтобы начать учёт оплат.':
    'To‘lovlar hisobini boshlash uchun birinchi o‘quvchini qo‘shing.',
  'Дождитесь загрузки остатка': 'Qoldiq yuklanishini kuting',
  Должники: 'Qarzdorlar',
  'Загружаем историю…': 'Tarix yuklanmoqda…',
  'Загружаем остаток…': 'Qoldiq yuklanmoqda…',
  'Загружаем учеников и оплаты': 'O‘quvchilar va to‘lovlar yuklanmoqda',
  'Загружаем…': 'Yuklanmoqda…',
  'Загрузка данных': 'Ma’lumotlar yuklanmoqda',
  'Загрузка сводки': 'Hisobot yuklanmoqda',
  'Загрузка…': 'Yuklanmoqda…',
  Закрыть: 'Yopish',
  'Закрыть уведомление': 'Bildirishnomani yopish',
  'Имя и фамилия': 'Ism va familiya',
  'Имя, группа или телефон': 'Ism, guruh yoki telefon',
  'История оплат': 'To‘lovlar tarixi',
  'Класс — главная': 'Sinf — bosh sahifa',
  Логин: 'Login',
  Месяц: 'Oy',
  'Месяц ещё не начался': 'Oy hali boshlanmagan',
  'Например, English · A2': 'Masalan, English · A2',
  'Например, Азиза Каримова': 'Masalan, Aziza Karimova',
  'Не оплатившие': 'To‘lamaganlar',
  'Не удалось войти. Попробуйте снова.': 'Kirish amalga oshmadi. Qayta urinib ko‘ring.',
  'Не удалось выйти': 'Chiqish amalga oshmadi',
  'Не удалось загрузить оплаты': 'To‘lovlarni yuklab bo‘lmadi',
  'Не удалось загрузить остаток': 'Qoldiqni yuklab bo‘lmadi',
  'Не удалось подключиться к серверу': 'Serverga ulanib bo‘lmadi',
  'Не удалось сохранить. Повторите попытку.': 'Saqlab bo‘lmadi. Qayta urinib ko‘ring.',
  'Нет учеников': 'O‘quvchilar yo‘q',
  'Нет учеников по фильтру': 'Bu filtr bo‘yicha o‘quvchilar yo‘q',
  'Никого не нашли': 'Hech kim topilmadi',
  'Новая месячная сумма применяется и при просмотре прошлых месяцев.':
    'Yangi oylik summa oldingi oylar uchun ham qo‘llanadi.',
  'Новый ученик': 'Yangi o‘quvchi',
  'Ожидают оплаты': 'To‘lov kutilmoqda',
  'Оплата #': 'To‘lov #',
  'Оплата в месяц': 'Oylik to‘lov',
  'Оплата за месяц': 'Oy uchun to‘lov',
  'Оплата успешно внесена': 'To‘lov kiritildi',
  Оплатившие: 'To‘laganlar',
  Оплатили: 'To‘laganlar',
  Оплачено: 'To‘langan',
  Осталось: 'Qoldiq',
  Отмена: 'Bekor qilish',
  'Очистить поиск': 'Qidiruvni tozalash',
  Пароль: 'Parol',
  'Перейти к содержимому': 'Asosiy mazmunga o‘tish',
  'Платежей пока нет. Внесите первую оплату в карточке ученика.':
    'To‘lovlar hali yo‘q. O‘quvchi kartasida birinchi to‘lovni kiriting.',
  Повторить: 'Qayta urinish',
  'Поиск учеников': 'O‘quvchilarni qidirish',
  'Пока нет оплат': 'Hali to‘lov yo‘q',
  Показано: 'Ko‘rsatilgan',
  'Показать ещё 10': 'Yana 10 tasini ko‘rsatish',
  'Показать пароль': 'Parolni ko‘rsatish',
  'Показать по': 'Quyidagicha ko‘rsatish',
  'Показать по статусу оплаты': 'To‘lov holati bo‘yicha ko‘rsatish',
  'Попробовать снова': 'Qayta urinish',
  'Попробуйте другое имя, телефон или название группы.':
    'Boshqa ism, telefon yoki guruh nomini kiriting.',
  'Предыдущий месяц': 'Oldingi oy',
  'Раздел учёта': 'Hisob bo‘limi',
  Редактировать: 'Tahrirlash',
  'Редактировать ученика': 'O‘quvchini tahrirlash',
  'Сводка оплат за месяц': 'Oylik to‘lovlar hisoboti',
  'Скрыть пароль': 'Parolni yashirish',
  'Следующий месяц': 'Keyingi oy',
  'Сохранить изменения': 'O‘zgarishlarni saqlash',
  'Сохранить оплату': 'To‘lovni saqlash',
  'Сохраняем…': 'Saqlanmoqda…',
  'Сумма внесена полностью': 'Summa to‘liq to‘langan',
  'Сумма и число должников по месяцам': 'Oylar bo‘yicha qarz summasi va qarzdorlar soni',
  'Сумма оплаты': 'To‘lov summasi',
  'Сумма оплаты превышает остаток долга': 'To‘lov summasi qarz qoldig‘idan oshmasligi kerak',
  Текущий: 'Joriy',
  Телефон: 'Telefon',
  'Удалить ученика': 'O‘quvchini o‘chirish',
  'Удалить ученика?': 'O‘quvchi o‘chirilsinmi?',
  'Удаляем…': 'O‘chirilmoqda…',
  Ученик: 'O‘quvchi',
  'Ученик добавлен': 'O‘quvchi qo‘shildi',
  'Ученик удалён': 'O‘quvchi o‘chirildi',
  Ученики: 'O‘quvchilar',
  'Учёт оплат': 'To‘lovlar hisobi',
  'Это действие нельзя отменить': 'Bu amalni bekor qilib bo‘lmaydi',
  'в месяц': 'oyiga',
  записей: 'ta yozuv',
  'и вся его история оплат будут удалены. Восстановить данные не получится.':
    'va uning barcha to‘lovlari o‘chiriladi. Ma’lumotlarni tiklab bo‘lmaydi.',
  из: '/',
  карусель: 'karusel',
  класс: 'sinf',
  оплат: 'ta to‘lov',
  сум: 'so‘m',
  'Язык интерфейса': 'Interfeys tili',
  'Фильтр оплат': 'To‘lovlar filtri',
  Оплата: 'To‘lov',
  'Введите имя': 'Ismni kiriting',
  'Введите группу': 'Guruhni kiriting',
  'Неверный телефон': 'Telefon noto‘g‘ri',
  'Введите сумму цифрами': 'Summani raqamlar bilan kiriting',
  'Сумма должна быть целой': 'Summa butun son bo‘lishi kerak',
  'Сумма должна быть больше нуля': 'Summa noldan katta bo‘lishi kerak',
  'Сумма слишком большая': 'Summa juda katta',
  'Слишком много попыток входа. Попробуйте позже.':
    'Kirishga urinishlar juda ko‘p. Keyinroq urinib ko‘ring.',
  'Внутренняя ошибка сервера': 'Serverda ichki xatolik',
  'Ошибка валидации': 'Ma’lumotlarni tekshiring',
  'Неверный логин или пароль': 'Login yoki parol noto‘g‘ri',
  'Нет связи с сервером. Проверьте подключение и повторите.':
    'Server bilan aloqa yo‘q. Ulanishni tekshirib qayta urinib ko‘ring.',
  'Сессия завершена. Войдите снова.': 'Seans tugadi. Qayta kiring.',
  'Оплаты за месяц': 'Oylik to‘lovlar',
  Удалить: 'O‘chirish',
  'Введите название курса': 'Kurs nomini kiriting',
  'Курс не найден': 'Kurs topilmadi',
  'Такой курс уже существует': 'Bunday kurs mavjud',
  'Нельзя удалить курс с учениками': 'O‘quvchilari bor kursni o‘chirib bo‘lmaydi',
  'Изменение курса обновит стоимость всех его учеников, включая прошлые месяцы.':
    'Kurs narxi o‘zgarsa, barcha o‘quvchilarning narxi, shu jumladan oldingi oylar uchun ham yangilanadi.',
  Курсы: 'Kurslar',
  Курс: 'Kurs',
  'Новый курс': 'Yangi kurs',
  'Добавить курс': 'Kurs qo‘shish',
  'Название курса': 'Kurs nomi',
  'Выберите курс': 'Kursni tanlang',
  'Курс добавлен': 'Kurs qo‘shildi',
  'Курс обновлён': 'Kurs yangilandi',
  'Редактировать курс': 'Kursni tahrirlash',
  'Удалить курс': 'Kursni o‘chirish',
  'Удалить курс?': 'Kurs o‘chirilsinmi?',
  'Курс удалён': 'Kurs o‘chirildi',
  'Нет курсов': 'Kurslar yo‘q',
  'Сначала создайте курс, затем добавьте в него ученика.':
    'Avval kurs yarating, so‘ng unga o‘quvchi qo‘shing.',
  'Стоимость задаётся в курсе': 'Narx kursda belgilanadi',
  Название: 'Nomi',
};
function initialLanguage(): Language {
  try {
    return localStorage.getItem('ledger-language') === 'uz' ? 'uz' : 'ru';
  } catch {
    return 'ru';
  }
}
let language: Language = initialLanguage();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function setLanguage(next: Language): void {
  language = next;
  try {
    localStorage.setItem('ledger-language', next);
  } catch {
    /* Language still works without storage. */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.title = t('Класс · Учёт оплат');
  }
  listeners.forEach((listener) => listener());
}
export function t(text: string): string {
  return language === 'uz' ? (uz[text] ?? text) : text;
}
export function locale(): string {
  return language === 'uz' ? 'uz-Latn-UZ' : 'ru-RU';
}
export function money(amount: number, currency: Currency = 'UZS'): string {
  return `${moneyNumber(amount, currency)} ${t(currencyUnit(currency))}`;
}
export function localizedMonth(month: string): string {
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace(' г.', '');
}
export function useI18n() {
  useSyncExternalStore(
    subscribe,
    () => language,
    () => 'ru' as Language,
  );
  return {
    language,
    setLanguage,
    t,
    formatMoney: money,
    monthLabel: localizedMonth,
    locale: locale(),
  };
}
