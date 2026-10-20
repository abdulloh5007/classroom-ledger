import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

// Secrets come ONLY from the local .env, never from client code or external env overrides.
const file = existsSync('.env') ? parse(readFileSync('.env')) : {};
const env = z
  .object({
    BOT_TOKEN: z.string().default(''),
    WEB_USERNAME: z.string().min(1).default('admin'),
    WEB_PASSWORD: z
      .string()
      .refine(
        (value) => !value || value.length >= 6,
        'WEB_PASSWORD должен содержать минимум 6 символов',
      )
      .default(''),
    OWNER_ID: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    ),
    PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
    DB_PATH: z.string().min(1).default('./data/app.db'),
  })
  .parse(file);
if (env.BOT_TOKEN && !env.OWNER_ID) throw new Error('Заполните OWNER_ID в .env');
export const config = {
  webAuth: env.WEB_PASSWORD
    ? { username: env.WEB_USERNAME, password: env.WEB_PASSWORD }
    : undefined,
  botToken: env.BOT_TOKEN,
  ownerId: env.OWNER_ID,
  port: env.PORT,
  dbPath: env.DB_PATH,
};
