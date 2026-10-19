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
  type Student,
  type Payment,
  type PaymentPage,
  type Debtor,
  type Admin,
} from '../contracts.js';
import { monthRange, currentMonth } from '../calendar.js';
import { AppError } from '../errors.js';

const studentColumns =
  'id, name, phone, group_name AS "group", monthly_amount AS monthlyAmount, created_at AS createdAt';
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
  createStudent(input: unknown): Student {
    const data = studentSchema.parse(input);
    const result = this.db
      .prepare('INSERT INTO students(name, phone, group_name, monthly_amount) VALUES (?, ?, ?, ?)')
      .run(data.name, data.phone, data.group, data.monthlyAmount);
    return this.student(Number(result.lastInsertRowid));
  }
  updateStudent(id: unknown, input: unknown): Student {
    const patch = studentPatchSchema.parse(input);
    const existing = this.student(id);
    const data = { ...existing, ...patch };
    this.db
      .prepare('UPDATE students SET name=?, phone=?, group_name=?, monthly_amount=? WHERE id=?')
      .run(data.name, data.phone, data.group, data.monthlyAmount, existing.id);
    return this.student(existing.id);
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
    return this.db.transaction(() => {
      if (requestKey) {
        const receipt = this.db
          .prepare(
            `SELECT ${paymentColumns} FROM payments WHERE id=(SELECT payment_id FROM bot_receipts WHERE request_key=?)`,
          )
          .get(requestKey) as Payment | undefined;
        if (receipt) return receipt;
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
    })();
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
