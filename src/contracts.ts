import { z } from 'zod';

export const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const moneySchema = z
  .number({ invalid_type_error: 'Введите сумму цифрами', required_error: 'Введите сумму цифрами' })
  .int('Сумма должна быть целой')
  .min(1, 'Сумма должна быть больше нуля')
  .max(1_000_000_000_000, 'Сумма слишком большая');
export const monthSchema = z
  .string()
  .regex(/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/, 'Месяц: YYYY-MM (1900–9999)')
  .refine((value) => value !== '9999-12', 'Максимальный месяц: 9999-11');
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата: YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= '1900-01-01' &&
      value <= '9999-11-30'
    );
  }, 'Укажите существующую дату (1900–9999-11)');
const legacyStudentSchema = z
  .object({
    name: z.string().trim().min(1, 'Введите имя').max(100),
    phone: z
      .string()
      .trim()
      .min(5)
      .max(30)
      .regex(/^\+?[\d ()-]+$/, 'Неверный телефон'),
    group: z.string().trim().min(1, 'Введите группу').max(80),
    monthlyAmount: moneySchema,
  })
  .strict();
export const currencySchema = z.enum(['UZS', 'USD']);
export type Currency = z.infer<typeof currencySchema>;
export const courseSchema = z
  .object({
    name: z.string().trim().min(1, 'Введите название курса').max(80),
    currency: currencySchema.default('UZS'),
    monthlyAmount: moneySchema,
  })
  .strict();
export const coursePatchSchema = courseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Нет полей для изменения');
export const courseEnrollmentSchema = legacyStudentSchema.pick({ name: true, phone: true }).extend({
  courseId: z.coerce.number().int().positive('Выберите курс').max(Number.MAX_SAFE_INTEGER),
});
export const groupSchema = z
  .object({
    name: z.string().trim().min(1, 'Введите название группы').max(80),
    courseId: idSchema,
    startsOn: dateSchema.optional(),
  })
  .strict();
export const groupPatchSchema = z
  .object({
    name: groupSchema.shape.name.optional(),
    startsOn: dateSchema.optional(),
    courseName: courseSchema.shape.name.optional(),
    monthlyAmount: moneySchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Нет полей для изменения');
export const studentEnrollmentSchema = legacyStudentSchema
  .pick({ name: true, phone: true })
  .extend({
    groupId: z.coerce.number().int().positive('Выберите группу').max(Number.MAX_SAFE_INTEGER),
    enrolledOn: dateSchema.optional(),
  });
export const studentSchema = z.union([
  studentEnrollmentSchema,
  courseEnrollmentSchema,
  legacyStudentSchema,
]);
export const studentPatchSchema = z
  .union([
    studentEnrollmentSchema.partial(),
    courseEnrollmentSchema.partial(),
    legacyStudentSchema.partial(),
  ])
  .refine((value) => Object.keys(value).length > 0, 'Нет полей для изменения');
export const allocationSchema = z.object({ month: monthSchema, amount: moneySchema }).strict();
export const paymentSchema = z
  .object({
    amount: moneySchema,
    date: dateSchema,
    billingMonth: monthSchema.optional(),
    allocations: z.array(allocationSchema).min(1).max(24).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.allocations && value.billingMonth)
      ctx.addIssue({
        code: 'custom',
        path: ['billingMonth'],
        message: 'Выберите один способ распределения оплаты',
      });
    if (value.allocations) {
      const sum = value.allocations.reduce((total, item) => total + item.amount, 0);
      if (!Number.isSafeInteger(sum) || sum !== value.amount)
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'Распределение должно совпадать с общей суммой',
        });
      if (new Set(value.allocations.map((item) => item.month)).size !== value.allocations.length)
        ctx.addIssue({
          code: 'custom',
          path: ['allocations'],
          message: 'Месяцы не должны повторяться',
        });
    }
  });
export type StudentInput = z.infer<typeof studentSchema>;
export interface Group {
  startsOn: string | null;
  id: number;
  name: string;
  courseId: number;
  courseName: string;
  monthlyAmount: number;
  currency: Currency;
  studentCount: number;
  createdAt: string;
}
export interface Course {
  id: number;
  name: string;
  monthlyAmount: number;
  currency: Currency;
  studentCount: number;
  groupCount: number;
  createdAt: string;
}
export interface Student {
  enrolledOn: string | null;
  id: number;
  name: string;
  phone: string;
  group: string;
  monthlyAmount: number;
  currency: Currency;
  courseId: number;
  groupId: number;
  createdAt: string;
}
export interface Payment {
  allocations?: { month: string; amount: number }[];
  id: number;
  studentId: number;
  amount: number;
  date: string;
  createdAt: string;
}
export interface PaymentPage {
  items: Payment[];
  total: number;
  totalAmount: number;
  nextCursor: string | null;
}
export const paymentPageQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .refine((value) => !value.cursor || value.limit !== undefined, 'Для cursor укажите limit');
export interface Debtor {
  studentId: number;
  name: string;
  phone: string;
  group: string;
  monthlyAmount: number;
  currency: Currency;
  paid: number;
  debt: number;
}
export interface Admin {
  telegramId: number;
  addedBy: number;
  createdAt: string;
}

export const roleSchema = z.enum(['teacher', 'admin', 'owner']);
export type Role = z.infer<typeof roleSchema>;
export interface StaffUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  telegramId: number | null;
  groupIds: number[];
  createdAt: string;
}
export const staffCreateSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_.-]{3,64}$/, 'Логин: 3–64 латинских символа'),
    name: z.string().trim().min(1).max(100),
    role: z.enum(['teacher', 'admin']),
    password: z.string().min(8, 'Минимум 8 символов').max(128),
    telegramId: idSchema.nullable().optional(),
    groupIds: z.array(idSchema).max(500).default([]),
  })
  .strict();
export const staffPatchSchema = staffCreateSchema
  .omit({ password: true })
  .partial()
  .extend({
    active: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Нет изменений');
