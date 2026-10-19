import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/db/index.js';
import { LedgerService } from '../src/services/ledger.js';
import { createApp } from '../src/app.js';
let db: Database.Database;
let service: LedgerService;
beforeEach(() => {
  db = openDatabase(':memory:');
  service = new LedgerService(db);
});
afterEach(() => db.close());
it('создаёт курс и назначает ученику тариф только выбранного курса', () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 900000 });
  const student = service.createStudent({
    name: 'Test',
    phone: '+998901234567',
    courseId: course.id,
  });
  expect(student).toMatchObject({ courseId: course.id, group: 'English', monthlyAmount: 900000 });
  expect(service.course(course.id).studentCount).toBe(1);
  expect(() =>
    service.createStudent({ name: 'Test', phone: '+998901234567', courseId: 999 }),
  ).toThrow('Курс не найден');
  expect(() =>
    service.createStudent({
      name: 'Test',
      phone: '+998901234567',
      courseId: course.id,
      monthlyAmount: 1,
    }),
  ).toThrow();
});
it('обновляет цену/название всем ученикам и не удаляет занятый курс', () => {
  const a = service.createCourse({ name: 'English', monthlyAmount: 900000 });
  const b = service.createCourse({ name: 'Python', monthlyAmount: 1200000 });
  const student = service.createStudent({ name: 'Test', phone: '+998901234567', courseId: a.id });
  service.updateCourse(a.id, { name: 'English A2', monthlyAmount: 1000000 });
  expect(service.student(student.id)).toMatchObject({
    group: 'English',
    monthlyAmount: 1000000,
  });
  expect(() => service.deleteCourse(a.id)).toThrow('Нельзя удалить курс с учениками');
  service.updateStudent(student.id, { courseId: b.id });
  expect(service.student(student.id)).toMatchObject({ courseId: b.id, monthlyAmount: 1200000 });
  expect(() => service.deleteCourse(a.id)).toThrow('Нельзя удалить курс с группами');
  const unused = service.createCourse({ name: 'Empty', monthlyAmount: 1000 });
  service.deleteCourse(unused.id);
  expect(service.courses()).toHaveLength(2);
  expect(() => service.createCourse({ name: 'Python', monthlyAmount: 1200000 })).toThrow(
    'Такой курс уже существует',
  );
});
it('валидирует CRUD курсов через API', async () => {
  const app = createApp(service);
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/courses',
      payload: { name: 'Frontend', monthlyAmount: 750000 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;
    expect((await app.inject('/courses')).json()).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/courses/${id}`,
          payload: { monthlyAmount: 800000 },
        })
      ).json(),
    ).toMatchObject({ monthlyAmount: 800000 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/courses',
          payload: { name: 'Bad', monthlyAmount: 1.5 },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/courses?unexpected=1')).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/courses/${id}` })).statusCode).toBe(204);
  } finally {
    await app.close();
  }
});
it('мигрирует старые группы/тарифы и сохраняет учеников и оплаты при повторном запуске', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-migration-'));
  const path = join(directory, 'app.db');
  let file: Database.Database | undefined;
  try {
    file = openDatabase(path);
    const old = new LedgerService(file);
    const first = old.createStudent({
      name: 'One',
      phone: '+998901234567',
      group: 'English',
      monthlyAmount: 1000,
    });
    old.createStudent({
      name: 'Two',
      phone: '+998901234567',
      group: 'English',
      monthlyAmount: 2000,
    });
    old.createStudent({
      name: 'Three',
      phone: '+998901234567',
      group: 'English',
      monthlyAmount: 1000,
    });
    old.addPayment(first.id, { amount: 400, date: '2026-10-01' });
    file.exec(
      'DROP TRIGGER group_student_match_insert; DROP TRIGGER group_student_match_update; DROP TRIGGER group_student_name; DROP TRIGGER group_course_immutable; DROP INDEX students_group; ALTER TABLE students DROP COLUMN group_id; DROP TABLE student_groups; DROP TRIGGER course_currency_immutable; DROP TRIGGER course_student_tariff; DROP INDEX students_course; ALTER TABLE students DROP COLUMN course_id; DROP TABLE courses; PRAGMA user_version=3;',
    );
    file.close();
    file = openDatabase(path);
    const migrated = new LedgerService(file);
    expect(migrated.courses()).toHaveLength(2);
    expect(migrated.students()).toHaveLength(3);
    expect(migrated.balance(first.id, '2026-10')).toEqual({ paid: 400, debt: 600 });
    expect(migrated.students().every((student) => student.courseId > 0)).toBe(true);
    file.close();
    file = openDatabase(path);
    expect(new LedgerService(file).courses()).toHaveLength(2);
    expect(file.pragma('foreign_key_check')).toEqual([]);
  } finally {
    if (file?.open) file.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
