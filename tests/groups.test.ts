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
it('назначает каждому ученику курс и тариф только его группы', () => {
  const english = service.createCourse({ name: 'English', monthlyAmount: 800000 });
  const maths = service.createCourse({ name: 'Maths', monthlyAmount: 600000 });
  const group = service.createGroup({ name: 'A1', courseId: english.id });
  const student = service.createStudent({ name: 'One', phone: '+998901234567', groupId: group.id });
  expect(student).toMatchObject({
    groupId: group.id,
    courseId: english.id,
    group: 'A1',
    monthlyAmount: 800000,
  });
  expect(() =>
    service.createStudent({
      name: 'Bad',
      phone: '+998901234567',
      groupId: group.id,
      courseId: maths.id,
    }),
  ).toThrow();
  expect(() =>
    service.updateStudent(student.id, { groupId: group.id, monthlyAmount: 1 }),
  ).toThrow();
  expect(() =>
    db.prepare('UPDATE students SET course_id=? WHERE id=?').run(maths.id, student.id),
  ).toThrow('Student must match');
  expect(() =>
    db.prepare('UPDATE student_groups SET course_id=? WHERE id=?').run(maths.id, group.id),
  ).toThrow('Group course cannot be changed');
  service.updateCourse(english.id, { name: 'Advanced English', monthlyAmount: 900000 });
  expect(service.student(student.id)).toMatchObject({ group: 'A1', monthlyAmount: 900000 });
  expect(service.group(group.id)).toMatchObject({
    courseName: 'Advanced English',
    studentCount: 1,
  });
});
it('разделяет списки и месячные долги групп, сохраняя общий API без groupId', () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 800000 });
  const a = service.createGroup({ name: 'A1', courseId: course.id });
  const b = service.createGroup({ name: 'A2', courseId: course.id });
  const one = service.createStudent({ name: 'One', phone: '+998901234567', groupId: a.id });
  const two = service.createStudent({ name: 'Two', phone: '+998901234567', groupId: b.id });
  service.addPayment(one.id, { amount: 200000, date: '2026-10-01' });
  service.addPayment(two.id, { amount: 800000, date: '2026-10-01' });
  expect(service.students(a.id).map((row) => row.id)).toEqual([one.id]);
  expect(service.debtors('2026-10', a.id)).toMatchObject([{ studentId: one.id, debt: 600000 }]);
  expect(service.debtors('2026-10', b.id)).toEqual([]);
  expect(service.monthlyBalances('2026-10', b.id)).toMatchObject([
    { studentId: two.id, paid: 800000, debt: 0 },
  ]);
  expect(service.students()).toHaveLength(2);
  expect(service.monthlyBalances('2026-10')).toHaveLength(2);
});
it('создаёт и валидирует группы через защищённый маршрутизатор', async () => {
  const course = service.createCourse({ name: 'English', monthlyAmount: 800000 });
  const app = createApp(service);
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/groups',
      payload: { name: 'A1', courseId: course.id },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;
    expect((await app.inject('/groups')).json()).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/groups',
          payload: { name: 'A1', courseId: course.id },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/groups',
          payload: { name: 'Bad', courseId: 999 },
        })
      ).statusCode,
    ).toBe(404);
    for (const url of [
      '/groups?extra=1',
      '/students?groupId=bad',
      '/debtors?groupId=bad',
      '/balances?groupId=bad',
    ])
      expect((await app.inject(url)).statusCode).toBe(400);
    expect((await app.inject(`/students?groupId=${id}`)).json()).toEqual([]);
    expect((await app.inject(`/balances?month=2026-10&groupId=${id}`)).json()).toEqual([]);
    expect((await app.inject('/students?groupId=999')).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url: `/groups/${id}`, payload: { courseId: 1 } }))
        .statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
it('мигрирует v4 в группы без изменения прежних учеников, курсов и оплат', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-groups-'));
  const path = join(directory, 'app.db');
  let file: Database.Database | undefined;
  try {
    file = openDatabase(path);
    const old = new LedgerService(file);
    const first = old.createStudent({
      name: 'One',
      phone: '+998901234567',
      group: 'A1',
      monthlyAmount: 1000,
    });
    old.createStudent({ name: 'Two', phone: '+998901234567', group: 'A1', monthlyAmount: 2000 });
    old.addPayment(first.id, { amount: 300, date: '2026-10-01' });
    const students = file
      .prepare(
        'SELECT id,name,phone,group_name,monthly_amount,course_id,created_at FROM students ORDER BY id',
      )
      .all();
    const payments = file.prepare('SELECT * FROM payments').all();
    file.exec(
      'DROP TRIGGER group_student_match_insert; DROP TRIGGER group_student_match_update; DROP TRIGGER group_student_name; DROP TRIGGER group_course_immutable; DROP INDEX students_group; ALTER TABLE students DROP COLUMN group_id; DROP TABLE student_groups; PRAGMA user_version=4;',
    );
    file.close();
    file = openDatabase(path);
    expect(
      file
        .prepare(
          'SELECT id,name,phone,group_name,monthly_amount,course_id,created_at FROM students ORDER BY id',
        )
        .all(),
    ).toEqual(students);
    expect(file.prepare('SELECT * FROM payments').all()).toEqual(payments);
    expect(new LedgerService(file).groups()).toHaveLength(2);
    expect(file.pragma('foreign_key_check')).toEqual([]);
    file.close();
    file = openDatabase(path);
    expect(new LedgerService(file).groups()).toHaveLength(2);
  } finally {
    if (file?.open) file.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
