import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
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
  groupSchema,
  groupPatchSchema,
  type Currency,
  type Group,
  type Course,
  type Student,
  type Payment,
  type PaymentPage,
  type Debtor,
  type Admin,
} from '../contracts.js';
import { monthRange, currentMonth, today } from '../calendar.js';
import { parseMoneyInput } from '../money.js';
import { AppError } from '../errors.js';
import { AccountService } from './accounts.js';

const studentColumns =
  'id, name, phone, group_name AS "group", (SELECT currency FROM courses WHERE id=students.course_id) AS currency, monthly_amount AS monthlyAmount, course_id AS courseId, group_id AS groupId, enrolled_on AS enrolledOn, created_at AS createdAt';
const paymentColumns =
  'id, student_id AS studentId, amount, paid_at AS date, created_at AS createdAt';
export class LedgerService {
  constructor(
    public readonly db: Database.Database,
    public readonly ownerId?: number,
    private readonly actorId?: number,
  ) {}
  asUser(id: number): LedgerService {
    new AccountService(this.db).active(id);
    return new LedgerService(this.db, this.ownerId, id);
  }
  forTelegram(id: number): LedgerService {
    const user = new AccountService(this.db).byTelegram(id);
    if (user) return this.asUser(user.id);
    if (!this.canAccess(id)) throw new AppError(403, 'Нет доступа');
    return this;
  }
  private scopeId(): number | null {
    if (this.actorId === undefined) return null;
    const actor = new AccountService(this.db).active(this.actorId);
    return actor.role === 'teacher' ? actor.id : null;
  }
  private requireCourseWrite(): void {
    if (this.scopeId() !== null)
      throw new AppError(403, 'Изменять курсы и цены могут администратор и владелец');
  }
  private assertGroupAccess(id: number, message = 'Группа не найдена'): void {
    const scope = this.scopeId();
    if (
      scope !== null &&
      !this.db.prepare('SELECT 1 FROM staff_groups WHERE user_id=? AND group_id=?').get(scope, id)
    )
      throw new AppError(404, message);
  }
  private audit(
    action: string,
    type: string,
    id: number,
    details: Record<string, unknown> = {},
  ): void {
    if (this.actorId !== undefined)
      new AccountService(this.db).audit(this.actorId, action, type, id, details);
  }
  firstMonth(student: Student): string | null {
    const group = this.group(student.groupId);
    const start = [group.startsOn, student.enrolledOn]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return start?.slice(0, 7) ?? null;
  }
  private enrollmentDate(group: Group, value?: string, legacyImport = false): string | null {
    const date =
      value ??
      (legacyImport && !group.startsOn
        ? null
        : group.startsOn && group.startsOn > today()
          ? group.startsOn
          : today());
    if (date && group.startsOn && date < group.startsOn)
      throw new AppError(400, 'Зачисление не может быть раньше начала группы', {
        fieldErrors: { enrolledOn: ['Выберите дату не раньше начала группы'] },
      });
    return date;
  }
  private withAllocations(payment: Payment): Payment {
    return {
      ...payment,
      allocations: this.db
        .prepare(
          'SELECT billing_month AS month,amount FROM payment_allocations WHERE payment_id=? ORDER BY billing_month',
        )
        .all(payment.id) as { month: string; amount: number }[],
    };
  }
  students(rawGroupId?: unknown): Student[] {
    const groupId = rawGroupId === undefined ? undefined : this.group(rawGroupId).id;
    return this.db
      .prepare(
        `SELECT ${studentColumns} FROM students WHERE (? IS NULL OR group_id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM staff_groups sg WHERE sg.group_id=students.group_id AND sg.user_id=?)) ORDER BY name COLLATE NOCASE, id`,
      )
      .all(groupId ?? null, groupId ?? null, this.scopeId(), this.scopeId()) as Student[];
  }
  student(rawId: unknown): Student {
    const id = idSchema.parse(rawId);
    const result = this.db
      .prepare(`SELECT ${studentColumns} FROM students WHERE id = ?`)
      .get(id) as Student | undefined;
    if (!result) throw new AppError(404, 'Ученик не найден');
    this.assertGroupAccess(result.groupId, 'Ученик не найден');
    return result;
  }
  courses(): Course[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.currency, c.monthly_amount AS monthlyAmount, c.created_at AS createdAt, (SELECT COUNT(*) FROM student_groups WHERE course_id=c.id) AS groupCount, COUNT(s.id) AS studentCount FROM courses c LEFT JOIN students s ON s.course_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE, c.id`,
      )
      .all() as Course[];
    if (this.scopeId() === null) return rows;
    const groups = this.groups();
    return rows.map((course) => ({
      ...course,
      groupCount: groups.filter((group) => group.courseId === course.id).length,
      studentCount: groups
        .filter((group) => group.courseId === course.id)
        .reduce((sum, group) => sum + group.studentCount, 0),
    }));
  }
  course(rawId: unknown): Course {
    const id = idSchema.parse(rawId);
    const course = this.db
      .prepare(
        `SELECT c.id, c.name, c.currency, c.monthly_amount AS monthlyAmount, c.created_at AS createdAt, (SELECT COUNT(*) FROM students WHERE course_id=c.id) AS studentCount, (SELECT COUNT(*) FROM student_groups WHERE course_id=c.id) AS groupCount FROM courses c WHERE c.id=?`,
      )
      .get(id) as Course | undefined;
    if (!course) throw new AppError(404, 'Курс не найден');
    if (this.scopeId() !== null) {
      const groups = this.groups().filter((group) => group.courseId === course.id);
      return {
        ...course,
        groupCount: groups.length,
        studentCount: groups.reduce((sum, group) => sum + group.studentCount, 0),
      };
    }
    return course;
  }
  createCourse(input: unknown): Course {
    this.requireCourseWrite();
    const data = courseSchema.parse(input);
    return this.db
      .transaction(() => {
        if (
          this.db
            .prepare('SELECT id FROM courses WHERE name=? AND monthly_amount=? AND currency=?')
            .get(data.name, data.monthlyAmount, data.currency)
        )
          throw new AppError(409, 'Такой курс уже существует');
        const result = this.db
          .prepare('INSERT INTO courses(name, monthly_amount, currency) VALUES (?, ?, ?)')
          .run(data.name, data.monthlyAmount, data.currency);
        const id = Number(result.lastInsertRowid);
        this.audit('course.create', 'course', id);
        return this.course(id);
      })
      .immediate();
  }
  updateCourse(rawId: unknown, input: unknown): Course {
    this.requireCourseWrite();
    const patch = coursePatchSchema.parse(input);
    return this.db
      .transaction(() => {
        const existing = this.course(rawId);
        const data = { ...existing, ...patch };
        if (data.currency !== existing.currency && existing.studentCount)
          throw new AppError(409, 'Нельзя менять валюту курса с учениками');
        if (
          this.db
            .prepare(
              'SELECT id FROM courses WHERE name=? AND monthly_amount=? AND currency=? AND id<>?',
            )
            .get(data.name, data.monthlyAmount, data.currency, existing.id)
        )
          throw new AppError(409, 'Такой курс уже существует');
        this.db
          .prepare('UPDATE courses SET name=?, monthly_amount=?, currency=? WHERE id=?')
          .run(data.name, data.monthlyAmount, data.currency, existing.id);
        this.audit('course.update', 'course', existing.id, { fields: Object.keys(patch) });
        return this.course(existing.id);
      })
      .immediate();
  }
  deleteCourse(rawId: unknown): void {
    this.requireCourseWrite();
    this.db
      .transaction(() => {
        const course = this.course(rawId);
        if (course.studentCount) throw new AppError(409, 'Нельзя удалить курс с учениками');
        if (course.groupCount) throw new AppError(409, 'Нельзя удалить курс с группами');
        this.db.prepare('DELETE FROM courses WHERE id=?').run(course.id);
        this.audit('course.delete', 'course', course.id);
      })
      .immediate();
  }
  private legacyCourse(name: string, amount: number): Course {
    const existing = this.db
      .prepare('SELECT id FROM courses WHERE name=? AND monthly_amount=? AND currency=?')
      .get(name, amount, 'UZS') as { id: number } | undefined;
    return existing ? this.course(existing.id) : this.createCourse({ name, monthlyAmount: amount });
  }
  groups(): Group[] {
    return this.db
      .prepare(
        `SELECT g.id, g.name, g.course_id AS courseId, c.name AS courseName, c.currency, c.monthly_amount AS monthlyAmount, g.starts_on AS startsOn, g.created_at AS createdAt, (SELECT COUNT(*) FROM students WHERE group_id=g.id) AS studentCount FROM student_groups g JOIN courses c ON c.id=g.course_id WHERE (? IS NULL OR EXISTS(SELECT 1 FROM staff_groups sg WHERE sg.group_id=g.id AND sg.user_id=?)) ORDER BY g.id`,
      )
      .all(this.scopeId(), this.scopeId()) as Group[];
  }
  group(rawId: unknown): Group {
    const id = idSchema.parse(rawId);
    this.assertGroupAccess(id);
    const group = this.db
      .prepare(
        `SELECT g.id, g.name, g.course_id AS courseId, c.name AS courseName, c.currency, c.monthly_amount AS monthlyAmount, g.starts_on AS startsOn, g.created_at AS createdAt, (SELECT COUNT(*) FROM students WHERE group_id=g.id) AS studentCount FROM student_groups g JOIN courses c ON c.id=g.course_id WHERE g.id=?`,
      )
      .get(id) as Group | undefined;
    if (!group) throw new AppError(404, 'Группа не найдена');
    return group;
  }
  createGroup(input: unknown): Group {
    const data = groupSchema.parse(input);
    if (this.actorId !== undefined && !data.startsOn)
      throw new AppError(400, 'Укажите начало обучения', {
        fieldErrors: { startsOn: ['Выберите дату начала группы'] },
      });
    return this.db
      .transaction(() => {
        this.course(data.courseId);
        if (
          this.db
            .prepare('SELECT id FROM student_groups WHERE name=? AND course_id=?')
            .get(data.name, data.courseId)
        )
          throw new AppError(409, 'Такая группа уже существует');
        const result = this.db
          .prepare('INSERT INTO student_groups(name, course_id,starts_on) VALUES (?, ?, ?)')
          .run(data.name, data.courseId, data.startsOn ?? null);
        const id = Number(result.lastInsertRowid);
        if (this.scopeId() !== null)
          this.db
            .prepare('INSERT INTO staff_groups(user_id,group_id) VALUES(?,?)')
            .run(this.actorId, id);
        this.audit('group.create', 'group', id);
        return this.group(id);
      })
      .immediate();
  }
  updateGroup(rawId: unknown, input: unknown): Group {
    const patch = groupPatchSchema.parse(input);
    if (patch.monthlyAmount !== undefined || patch.courseName !== undefined)
      this.requireCourseWrite();
    return this.db
      .transaction(() => {
        const group = this.group(rawId);
        const name = patch.name ?? group.name;
        if (
          this.db
            .prepare('SELECT id FROM student_groups WHERE name=? AND course_id=? AND id<>?')
            .get(name, group.courseId, group.id)
        )
          throw new AppError(409, 'Такая группа уже существует');
        if (patch.courseName !== undefined || patch.monthlyAmount !== undefined)
          this.updateCourse(group.courseId, {
            name: patch.courseName ?? group.courseName,
            monthlyAmount: patch.monthlyAmount ?? group.monthlyAmount,
          });
        const startsOn = patch.startsOn ?? group.startsOn;
        if (startsOn) {
          const incompatible = this.db
            .prepare(
              'SELECT 1 FROM payments p JOIN payment_allocations a ON a.payment_id=p.id JOIN students s ON s.id=p.student_id WHERE s.group_id=? AND a.billing_month<? LIMIT 1',
            )
            .get(group.id, startsOn.slice(0, 7));
          const enrollment = this.db
            .prepare(
              'SELECT 1 FROM students WHERE group_id=? AND enrolled_on IS NOT NULL AND enrolled_on<? LIMIT 1',
            )
            .get(group.id, startsOn);
          if (incompatible || enrollment)
            throw new AppError(
              409,
              'Дата начала противоречит зачислениям или уже зачтённым оплатам',
            );
        }
        this.db
          .prepare('UPDATE student_groups SET name=?,starts_on=? WHERE id=?')
          .run(name, startsOn, group.id);
        this.audit('group.update', 'group', group.id, { fields: Object.keys(patch) });
        return this.group(group.id);
      })
      .immediate();
  }
  deleteGroup(rawId: unknown): void {
    this.db
      .transaction(() => {
        const group = this.group(rawId);
        this.db.prepare('DELETE FROM students WHERE group_id=?').run(group.id);
        this.db.prepare('DELETE FROM student_groups WHERE id=?').run(group.id);
        // Keep a shared course and every other group's data intact.
        const course = this.course(group.courseId);
        if (!course.studentCount && !course.groupCount && this.scopeId() === null)
          this.deleteCourse(course.id);
        this.audit('group.delete', 'group', group.id);
      })
      .immediate();
  }
  private defaultGroup(name: string, courseId: number): Group {
    const existing = this.db
      .prepare('SELECT id FROM student_groups WHERE name=? AND course_id=?')
      .get(name, courseId) as { id: number } | undefined;
    if (existing) return this.group(existing.id);
    // Compatibility import: a v1 free-text group has no verified teaching start.
    const result = this.db
      .prepare('INSERT INTO student_groups(name,course_id) VALUES(?,?)')
      .run(name, courseId);
    return this.group(Number(result.lastInsertRowid));
  }
  createStudent(input: unknown): Student {
    const data = studentSchema.parse(input);
    if (this.scopeId() !== null && !('groupId' in data))
      throw new AppError(403, 'Учитель зачисляет ученика в существующую группу');
    return this.db
      .transaction(() => {
        const group =
          'groupId' in data
            ? this.group(data.groupId)
            : 'courseId' in data
              ? this.defaultGroup(this.course(data.courseId).name, data.courseId)
              : this.defaultGroup(data.group, this.legacyCourse(data.group, data.monthlyAmount).id);
        const result = this.db
          .prepare(
            'INSERT INTO students(name, phone, group_name, monthly_amount, course_id, group_id,enrolled_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            data.name,
            data.phone,
            group.name,
            group.monthlyAmount,
            group.courseId,
            group.id,
            this.enrollmentDate(
              group,
              'enrolledOn' in data ? data.enrolledOn : undefined,
              !('groupId' in data),
            ),
          );
        const id = Number(result.lastInsertRowid);
        this.audit('student.create', 'student', id);
        return this.student(id);
      })
      .immediate();
  }
  updateStudent(id: unknown, input: unknown): Student {
    const patch = studentPatchSchema.parse(input);
    if (
      this.scopeId() !== null &&
      ('group' in patch || 'courseId' in patch || 'monthlyAmount' in patch)
    )
      throw new AppError(403, 'Выберите доступную группу');
    return this.db
      .transaction(() => {
        const existing = this.student(id);
        const group =
          'groupId' in patch && patch.groupId !== undefined
            ? this.group(patch.groupId)
            : 'courseId' in patch && patch.courseId !== undefined
              ? this.defaultGroup(this.course(patch.courseId).name, patch.courseId)
              : 'group' in patch || 'monthlyAmount' in patch
                ? this.defaultGroup(
                    'group' in patch && patch.group !== undefined ? patch.group : existing.group,
                    this.legacyCourse(
                      'group' in patch && patch.group !== undefined ? patch.group : existing.group,
                      'monthlyAmount' in patch && patch.monthlyAmount !== undefined
                        ? patch.monthlyAmount
                        : existing.monthlyAmount,
                    ).id,
                  )
                : this.group(existing.groupId);
        if (
          existing.currency !== group.currency &&
          this.db.prepare('SELECT 1 FROM payments WHERE student_id=? LIMIT 1').get(existing.id)
        )
          throw new AppError(409, 'Нельзя переводить ученика с оплатами на курс в другой валюте');
        if (
          group.id !== existing.groupId &&
          this.db.prepare('SELECT 1 FROM payments WHERE student_id=? LIMIT 1').get(existing.id)
        )
          throw new AppError(
            409,
            'Перевод ученика с оплатами требует истории периодов и пока недоступен',
          );
        const enrolledOn =
          'enrolledOn' in patch && patch.enrolledOn !== undefined
            ? this.enrollmentDate(group, patch.enrolledOn)
            : existing.enrolledOn;
        if (enrolledOn && group.startsOn && enrolledOn < group.startsOn)
          throw new AppError(400, 'Зачисление не может быть раньше начала группы');
        if (
          enrolledOn &&
          this.db
            .prepare(
              'SELECT 1 FROM payments p JOIN payment_allocations a ON a.payment_id=p.id WHERE p.student_id=? AND a.billing_month<? LIMIT 1',
            )
            .get(existing.id, enrolledOn.slice(0, 7))
        )
          throw new AppError(409, 'Дата зачисления противоречит оплатам');
        this.db
          .prepare(
            'UPDATE students SET name=?, phone=?, group_name=?, monthly_amount=?, course_id=?, group_id=?, enrolled_on=? WHERE id=?',
          )
          .run(
            patch.name ?? existing.name,
            patch.phone ?? existing.phone,
            group.name,
            group.monthlyAmount,
            group.courseId,
            group.id,
            enrolledOn,
            existing.id,
          );
        this.audit('student.update', 'student', existing.id, { fields: Object.keys(patch) });
        return this.student(existing.id);
      })
      .immediate();
  }
  deleteStudent(id: unknown): void {
    const student = this.student(id);
    this.db
      .transaction(() => {
        this.db.prepare('DELETE FROM students WHERE id=?').run(student.id);
        this.audit('student.delete', 'student', student.id);
      })
      .immediate();
  }
  payments(id: unknown): Payment[] {
    const student = this.student(id);
    const rows = this.db
      .prepare(
        `SELECT ${paymentColumns} FROM payments WHERE student_id=? ORDER BY paid_at DESC,id DESC LIMIT 100`,
      )
      .all(student.id) as Payment[];
    return rows.map((row) => this.withAllocations(row));
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
        items: items.map((item) => this.withAllocations(item)),
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
          if (receipt) {
            if (receipt.studentId !== student.id)
              throw new AppError(409, 'Ключ оплаты уже использован');
            return this.withAllocations(receipt);
          }
        }
        const allocations = data.allocations ?? [
          { month: data.billingMonth ?? data.date.slice(0, 7), amount: data.amount },
        ];
        const first = this.firstMonth(student);
        for (const allocation of allocations) {
          if (first && allocation.month < first)
            throw new AppError(400, 'Период оплаты раньше начала обучения', {
              fieldErrors: { billingMonth: ['Выберите месяц не раньше ' + first] },
            });
          const remaining = this.balance(student.id, allocation.month).debt;
          if (allocation.amount > remaining) {
            const message = 'Сумма оплаты превышает остаток долга';
            throw new AppError(400, message, {
              fieldErrors: { amount: [message] },
              remaining,
              month: allocation.month,
            });
          }
        }
        const result = this.db
          .prepare('INSERT INTO payments(student_id,amount,paid_at) VALUES(?,?,?)')
          .run(student.id, data.amount, data.date);
        const paymentId = Number(result.lastInsertRowid);
        this.db.prepare('DELETE FROM payment_allocations WHERE payment_id=?').run(paymentId);
        for (const allocation of allocations)
          this.db
            .prepare(
              'INSERT INTO payment_allocations(payment_id,billing_month,amount) VALUES(?,?,?)',
            )
            .run(paymentId, allocation.month, allocation.amount);
        this.audit('payment.create', 'payment', paymentId, {
          studentId: student.id,
          months: allocations.map((item) => item.month),
        });
        if (requestKey)
          this.db
            .prepare('INSERT INTO bot_receipts(request_key, payment_id) VALUES (?, ?)')
            .run(requestKey, paymentId);
        return this.withAllocations(
          this.db
            .prepare(`SELECT ${paymentColumns} FROM payments WHERE id=?`)
            .get(paymentId) as Payment,
        );
      })
      .immediate();
  }
  balance(id: unknown, month = currentMonth()): { paid: number; debt: number } {
    const student = this.student(id);
    monthRange(month);
    const first = this.firstMonth(student);
    if (first && month < first) return { paid: 0, debt: 0 };
    const { paid } = this.db
      .prepare(
        'SELECT COALESCE(SUM(a.amount),0) AS paid FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE p.student_id=? AND a.billing_month=?',
      )
      .get(student.id, month) as { paid: number };
    this.assertSafe(paid);
    return { paid, debt: Math.max(0, this.courseTariff(student.courseId, month) - paid) };
  }

  courseTariff(rawCourseId: unknown, month = currentMonth()): number {
    const course = this.course(rawCourseId);
    monthRange(month);
    const tariff = this.db
      .prepare(
        `SELECT monthly_amount AS amount FROM course_tariffs WHERE course_id=? AND effective_month<=? ORDER BY effective_month DESC LIMIT 1`,
      )
      .get(course.id, month) as { amount: number } | undefined;
    return tariff?.amount ?? course.monthlyAmount;
  }

  debtors(month = currentMonth(), groupId?: unknown): Debtor[] {
    return this.monthlyBalances(month, groupId).filter((row) => row.debt > 0);
  }
  monthlyBalances(month = currentMonth(), rawGroupId?: unknown): Debtor[] {
    const groupId = rawGroupId === undefined ? undefined : this.group(rawGroupId).id;
    monthRange(month);
    const rows = this.db
      .prepare(
        `
      WITH tariffs AS (
        SELECT s.*,COALESCE((SELECT monthly_amount FROM course_tariffs WHERE course_id=s.course_id AND effective_month<=? ORDER BY effective_month DESC LIMIT 1),s.monthly_amount) AS period_amount
        FROM students s JOIN student_groups g ON g.id=s.group_id
        WHERE (? IS NULL OR s.group_id=?)
          AND (g.starts_on IS NULL OR substr(g.starts_on,1,7)<=?)
          AND (s.enrolled_on IS NULL OR substr(s.enrolled_on,1,7)<=?)
          AND (? IS NULL OR EXISTS(SELECT 1 FROM staff_groups sg WHERE sg.group_id=s.group_id AND sg.user_id=?))
      )
      SELECT s.id AS studentId,s.name,s.phone,s.group_name AS "group",(SELECT currency FROM courses WHERE id=s.course_id) AS currency,s.period_amount AS monthlyAmount,
        COALESCE(SUM(a.amount),0) AS paid,MAX(0,s.period_amount-COALESCE(SUM(a.amount),0)) AS debt
      FROM tariffs s LEFT JOIN payments p ON p.student_id=s.id LEFT JOIN payment_allocations a ON a.payment_id=p.id AND a.billing_month=?
      GROUP BY s.id ORDER BY debt DESC,s.name,s.id
    `,
      )
      .all(
        month,
        groupId ?? null,
        groupId ?? null,
        month,
        month,
        this.scopeId(),
        this.scopeId(),
        month,
      ) as Debtor[];
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
    const account = new AccountService(this.db).byTelegram(id);
    if (account) return account.active;
    if (this.db.prepare("SELECT 1 FROM staff_users WHERE role='owner'").get()) return false;
    return (
      this.isOwner(id) ||
      Boolean(this.db.prepare('SELECT 1 FROM admins WHERE telegram_id=?').get(id))
    );
  }
  admins(): Admin[] {
    if (this.db.prepare("SELECT 1 FROM staff_users WHERE role='owner'").get())
      return this.db
        .prepare(
          "SELECT telegram_id AS telegramId,? AS addedBy,created_at AS createdAt FROM staff_users WHERE role='admin' AND active=1 AND telegram_id IS NOT NULL ORDER BY id",
        )
        .all(this.ownerId ?? 0) as Admin[];
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
    const accounts = new AccountService(this.db);
    const owner = accounts.byTelegram(actor);
    if (owner?.role === 'owner') {
      const existing = accounts.byTelegram(id);
      if (existing) accounts.update(owner.id, existing.id, { role: 'admin', active: true });
      else
        accounts.create(owner.id, {
          username: 'tg_' + id,
          name: 'Telegram ' + id,
          role: 'admin',
          password: randomUUID(),
          telegramId: id,
        });
    }
    this.db
      .prepare('INSERT OR IGNORE INTO admins(telegram_id, added_by) VALUES (?, ?)')
      .run(id, actor);
  }
  nextAdminEnrollment(actor: number): {
    enabled: boolean;
    armedAt: number | null;
    claimedBy: number | null;
  } {
    this.requireOwner(actor);
    const row = this.db
      .prepare(
        'SELECT enabled, armed_by AS armedBy, armed_at AS armedAt, claimed_by AS claimedBy FROM bot_admin_enrollment WHERE singleton=1',
      )
      .get() as
      { enabled: number; armedBy: number; armedAt: number; claimedBy: number | null } | undefined;
    return {
      enabled: row?.enabled === 1 && row.armedBy === this.ownerId,
      armedAt: row?.armedAt ?? null,
      claimedBy: row?.claimedBy ?? null,
    };
  }
  armNextAdmin(actor: number): void {
    this.requireOwner(actor);
    this.db
      .transaction(() => {
        if (this.nextAdminEnrollment(actor).enabled) return;
        this.db
          .prepare(
            `INSERT INTO bot_admin_enrollment(singleton,enabled,armed_by,armed_at,claimed_by,claimed_at)
        VALUES(1,1,?,?,NULL,NULL)
        ON CONFLICT(singleton) DO UPDATE SET enabled=1,armed_by=excluded.armed_by,armed_at=excluded.armed_at,claimed_by=NULL,claimed_at=NULL`,
          )
          .run(actor, Math.floor(Date.now() / 1000));
      })
      .immediate();
  }
  cancelNextAdmin(actor: number): void {
    this.requireOwner(actor);
    this.db.prepare('UPDATE bot_admin_enrollment SET enabled=0 WHERE singleton=1').run();
  }
  claimNextAdmin(target: unknown, messageDate: number): boolean {
    const id = idSchema.parse(target);
    if (!Number.isSafeInteger(messageDate) || messageDate < 0 || !this.ownerId) return false;
    return this.db
      .transaction(() => {
        const enrollment = this.nextAdminEnrollment(this.ownerId!);
        if (
          !enrollment.enabled ||
          enrollment.armedAt === null ||
          messageDate < enrollment.armedAt ||
          this.canAccess(id)
        )
          return false;
        this.addAdmin(this.ownerId!, id);
        this.db
          .prepare(
            'UPDATE bot_admin_enrollment SET enabled=0,claimed_by=?,claimed_at=? WHERE singleton=1 AND enabled=1',
          )
          .run(id, Math.floor(Date.now() / 1000));
        return true;
      })
      .immediate();
  }
  removeAdmin(actor: number, target: unknown): void {
    this.requireOwner(actor);
    const id = idSchema.parse(target);
    if (this.isOwner(id)) throw new AppError(400, 'Владельца нельзя удалить');
    const accounts = new AccountService(this.db);
    const owner = accounts.byTelegram(actor);
    const targetUser = accounts.byTelegram(id);
    if (owner?.role === 'owner' && targetUser)
      accounts.update(owner.id, targetUser.id, { telegramId: null });
    this.db.prepare('DELETE FROM admins WHERE telegram_id=?').run(id);
  }
  private requireOwner(actor: number): void {
    if (!this.isOwner(actor)) throw new AppError(403, 'Только для владельца');
  }
}
export function parseAmount(text: string, currency: Currency = 'UZS'): number {
  const amount = parseMoneyInput(text, currency);
  if (amount === undefined)
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['amount'],
        message:
          currency === 'USD'
            ? 'Введите сумму в долларах, не более двух знаков после запятой'
            : 'Введите целую положительную сумму',
      },
    ]);
  return moneySchema.parse(amount);
}
