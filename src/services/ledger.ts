import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  idSchema,
  dateSchema,
  paymentPageQuery,
  moneySchema,
  paymentSchema,
  studentSchema,
  studentPatchSchema,
  courseSchema,
  coursePatchSchema,
  type Course,
  type Student,
  type Payment,
  type PaymentPage,
  type Debtor,
  type Admin,
} from '../contracts.js';
import { monthRange, currentMonth } from '../calendar.js';
import { AppError } from '../errors.js';

const studentColumns =
  'id, name, phone, group_name AS "group", monthly_amount AS monthlyAmount, course_id AS courseId, created_at AS createdAt';
const paymentColumns =
  'id, student_id AS studentId, amount, paid_at AS date, created_at AS createdAt';
export class LedgerService {
  constructor(
    public readonly db: Database.Database,
    public readonly ownerId?: number,
  ) {}
  students(): Student[] {
    return this.db
      .prepare(`SELECT ${studentColumns} FROM students ORDER BY name COLLATE NOCASE, id`)
      .all() as Student[];
  }
  student(rawId: unknown): Student {
    const id = idSchema.parse(rawId);
    const result = this.db
      .prepare(`SELECT ${studentColumns} FROM students WHERE id = ?`)
      .get(id) as Student | undefined;
    if (!result) throw new AppError(404, 'Ученик не найден');
    return result;
  }
  courses(): Course[] {
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.monthly_amount AS monthlyAmount, c.created_at AS createdAt, COUNT(s.id) AS studentCount FROM courses c LEFT JOIN students s ON s.course_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE, c.id`,
      )
      .all() as Course[];
  }
  course(rawId: unknown): Course {
    const id = idSchema.parse(rawId);
    const course = this.db
      .prepare(
        `SELECT c.id, c.name, c.monthly_amount AS monthlyAmount, c.created_at AS createdAt, (SELECT COUNT(*) FROM students WHERE course_id=c.id) AS studentCount FROM courses c WHERE c.id=?`,
      )
      .get(id) as Course | undefined;
    if (!course) throw new AppError(404, 'Курс не найден');
    return course;
  }
  createCourse(input: unknown): Course {
    const data = courseSchema.parse(input);
    return this.db
      .transaction(() => {
        if (
          this.db
            .prepare('SELECT id FROM courses WHERE name=? AND monthly_amount=?')
            .get(data.name, data.monthlyAmount)
        )
          throw new AppError(409, 'Такой курс уже существует');
        const result = this.db
          .prepare('INSERT INTO courses(name, monthly_amount) VALUES (?, ?)')
          .run(data.name, data.monthlyAmount);
        return this.course(Number(result.lastInsertRowid));
      })
      .immediate();
  }
  updateCourse(rawId: unknown, input: unknown): Course {
    const patch = coursePatchSchema.parse(input);
    return this.db
      .transaction(() => {
        const existing = this.course(rawId);
        const data = { ...existing, ...patch };
        if (
          this.db
            .prepare('SELECT id FROM courses WHERE name=? AND monthly_amount=? AND id<>?')
            .get(data.name, data.monthlyAmount, existing.id)
        )
          throw new AppError(409, 'Такой курс уже существует');
        this.db
          .prepare('UPDATE courses SET name=?, monthly_amount=? WHERE id=?')
          .run(data.name, data.monthlyAmount, existing.id);
        return this.course(existing.id);
      })
      .immediate();
  }
  deleteCourse(rawId: unknown): void {
    this.db
      .transaction(() => {
        const course = this.course(rawId);
        if (course.studentCount) throw new AppError(409, 'Нельзя удалить курс с учениками');
        this.db.prepare('DELETE FROM courses WHERE id=?').run(course.id);
      })
      .immediate();
  }
  private legacyCourse(name: string, amount: number): Course {
    const existing = this.db
      .prepare('SELECT id FROM courses WHERE name=? AND monthly_amount=?')
      .get(name, amount) as { id: number } | undefined;
    return existing ? this.course(existing.id) : this.createCourse({ name, monthlyAmount: amount });
  }
  createStudent(input: unknown): Student {
    const data = studentSchema.parse(input);
    return this.db
      .transaction(() => {
        const course =
          'courseId' in data
            ? this.course(data.courseId)
            : this.legacyCourse(data.group, data.monthlyAmount);
        const result = this.db
          .prepare(
            'INSERT INTO students(name, phone, group_name, monthly_amount, course_id) VALUES (?, ?, ?, ?, ?)',
          )
          .run(data.name, data.phone, course.name, course.monthlyAmount, course.id);
        return this.student(Number(result.lastInsertRowid));
      })
      .immediate();
  }
  updateStudent(id: unknown, input: unknown): Student {
    const patch = studentPatchSchema.parse(input);
    return this.db
      .transaction(() => {
        const existing = this.student(id);
        const course =
          'courseId' in patch && patch.courseId !== undefined
            ? this.course(patch.courseId)
            : this.legacyCourse(
                'group' in patch && patch.group !== undefined ? patch.group : existing.group,
                'monthlyAmount' in patch && patch.monthlyAmount !== undefined
                  ? patch.monthlyAmount
                  : existing.monthlyAmount,
              );
        this.db
          .prepare(
            'UPDATE students SET name=?, phone=?, group_name=?, monthly_amount=?, course_id=? WHERE id=?',
          )
          .run(
            patch.name ?? existing.name,
            patch.phone ?? existing.phone,
            course.name,
            course.monthlyAmount,
            course.id,
            existing.id,
          );
        return this.student(existing.id);
      })
      .immediate();
  }
  deleteStudent(id: unknown): void {
    const student = this.student(id);
    this.db.prepare('DELETE FROM students WHERE id=?').run(student.id);
  }
  payments(id: unknown): Payment[] {
    const student = this.student(id);
    return this.db
      .prepare(
        `SELECT ${paymentColumns} FROM payments WHERE student_id=? ORDER BY paid_at DESC, id DESC LIMIT 100`,
      )
      .all(student.id) as Payment[];
  }
  paymentPage(id: unknown, input: unknown): PaymentPage {
    const student = this.student(id);
    const query = paymentPageQuery.parse(input);
    const limit = query.limit ?? 10;
    let cursor: { date: string; id: number } | undefined;
    if (query.cursor) {
      try {
        cursor = z
          .object({ date: dateSchema, id: idSchema })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as unknown);
      } catch {
        throw new AppError(400, 'Неверный курсор истории оплат');
      }
    }
    return this.db.transaction(() => {
      const totals = this.db
        .prepare(
          'SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS totalAmount FROM payments WHERE student_id=?',
        )
        .get(student.id) as { total: number; totalAmount: number };
      this.assertSafe(totals.totalAmount);
      const items = (
        cursor
          ? this.db
              .prepare(
                `SELECT ${paymentColumns} FROM payments WHERE student_id=?
            AND (paid_at < ? OR (paid_at = ? AND id < ?)) ORDER BY paid_at DESC, id DESC LIMIT ?`,
              )
              .all(student.id, cursor.date, cursor.date, cursor.id, limit + 1)
          : this.db
              .prepare(
                `SELECT ${paymentColumns} FROM payments WHERE student_id=?
            ORDER BY paid_at DESC, id DESC LIMIT ?`,
              )
              .all(student.id, limit + 1)
      ) as Payment[];
      const more = items.length > limit;
      if (more) items.pop();
      const last = items.at(-1);
      return {
        ...totals,
        items,
        nextCursor:
          more && last
            ? Buffer.from(JSON.stringify({ date: last.date, id: last.id })).toString('base64url')
            : null,
      };
    })();
  }
  addPayment(id: unknown, input: unknown, requestKey?: string): Payment {
    const data = paymentSchema.parse(input);
    const student = this.student(id);
    return this.db
      .transaction(() => {
        if (requestKey) {
          const receipt = this.db
            .prepare(
              `SELECT ${paymentColumns} FROM payments WHERE id=(SELECT payment_id FROM bot_receipts WHERE request_key=?)`,
            )
            .get(requestKey) as Payment | undefined;
          if (receipt) return receipt;
        }
        const remaining = this.balance(student.id, data.date.slice(0, 7)).debt;
        if (data.amount > remaining) {
          const message = 'Сумма оплаты превышает остаток долга';
          throw new AppError(400, message, { fieldErrors: { amount: [message] }, remaining });
        }
        const result = this.db
          .prepare('INSERT INTO payments(student_id, amount, paid_at) VALUES (?, ?, ?)')
          .run(student.id, data.amount, data.date);
        const paymentId = Number(result.lastInsertRowid);
        if (requestKey)
          this.db
            .prepare('INSERT INTO bot_receipts(request_key, payment_id) VALUES (?, ?)')
            .run(requestKey, paymentId);
        return this.db
          .prepare(`SELECT ${paymentColumns} FROM payments WHERE id=?`)
          .get(paymentId) as Payment;
      })
      .immediate();
  }
  balance(id: unknown, month = currentMonth()): { paid: number; debt: number } {
    const student = this.student(id);
    const { start, end } = monthRange(month);
    const { paid } = this.db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE student_id=? AND paid_at>=? AND paid_at<?',
      )
      .get(student.id, start, end) as { paid: number };
    this.assertSafe(paid);
    return { paid, debt: Math.max(0, student.monthlyAmount - paid) };
  }
  debtors(month = currentMonth()): Debtor[] {
    return this.monthlyBalances(month).filter((row) => row.debt > 0);
  }
  monthlyBalances(month = currentMonth()): Debtor[] {
    const { start, end } = monthRange(month);
    const rows = this.db
      .prepare(
        `
      SELECT s.id AS studentId, s.name, s.phone, s.group_name AS "group", s.monthly_amount AS monthlyAmount,
        COALESCE(SUM(p.amount), 0) AS paid, MAX(0, s.monthly_amount - COALESCE(SUM(p.amount), 0)) AS debt
      FROM students s LEFT JOIN payments p ON p.student_id=s.id AND p.paid_at>=? AND p.paid_at<?
      GROUP BY s.id ORDER BY debt DESC, s.name, s.id
    `,
      )
      .all(start, end) as Debtor[];
    for (const row of rows) this.assertSafe(row.paid);
    this.assertSafe(rows.reduce((sum, row) => sum + row.debt, 0));
    return rows;
  }
  private assertSafe(value: number): void {
    if (!Number.isSafeInteger(value))
      throw new AppError(400, 'Сумма выходит за допустимый диапазон целых чисел');
  }
  isOwner(id: number): boolean {
    return id === this.ownerId;
  }
  canAccess(id: number): boolean {
    return (
      this.isOwner(id) ||
      Boolean(this.db.prepare('SELECT 1 FROM admins WHERE telegram_id=?').get(id))
    );
  }
  admins(): Admin[] {
    return this.db
      .prepare(
        'SELECT telegram_id AS telegramId, added_by AS addedBy, created_at AS createdAt FROM admins ORDER BY created_at, telegram_id',
      )
      .all() as Admin[];
  }
  addAdmin(actor: number, target: unknown): void {
    this.requireOwner(actor);
    const id = idSchema.parse(target);
    if (this.isOwner(id)) return;
    this.db
      .prepare('INSERT OR IGNORE INTO admins(telegram_id, added_by) VALUES (?, ?)')
      .run(id, actor);
  }
  removeAdmin(actor: number, target: unknown): void {
    this.requireOwner(actor);
    const id = idSchema.parse(target);
    if (this.isOwner(id)) throw new AppError(400, 'Владельца нельзя удалить');
    this.db.prepare('DELETE FROM admins WHERE telegram_id=?').run(id);
  }
  private requireOwner(actor: number): void {
    if (!this.isOwner(actor)) throw new AppError(403, 'Только для владельца');
  }
}
export function parseAmount(text: string): number {
  const compact = text.replace(/[ \u00a0\u202f]/g, '');
  if (!/^\d+$/.test(compact))
    throw new z.ZodError([
      { code: 'custom', path: ['amount'], message: 'Введите целую положительную сумму' },
    ]);
  return moneySchema.parse(Number(compact));
}
