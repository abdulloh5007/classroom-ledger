import { resolve, sep, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

// Secrets come ONLY from the local .env, never from client code or external env overrides.
const file = existsSync('.env') ? parse(readFileSync('.env')) : {};
const env = z
  .object({
    APP_STAGE: z.enum(['preview', 'production']).default('preview'),
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
    PORT: z.coerce.number().int().min(1024).max(65535).default(3108),
    DB_PATH: z.string().min(1).default('./data/preview.db'),
  })
  .parse(file);
if (env.APP_STAGE === 'preview') {
  if (env.BOT_TOKEN)
    throw new Error('В preview BOT_TOKEN должен быть пустым: рабочий бот не запускается');
  const database = resolve(env.DB_PATH);
  if (!database.startsWith(resolve('data') + sep) || !basename(database).startsWith('preview'))
    throw new Error('Preview использует только отдельную БД data/preview*.db');
}
if (env.APP_STAGE === 'production' && !env.WEB_PASSWORD)
  throw new Error('Для production задайте WEB_PASSWORD');
if (env.BOT_TOKEN && !env.OWNER_ID) throw new Error('Заполните OWNER_ID в .env');
export const config = {
  stage: env.APP_STAGE,
  webAuth: env.WEB_PASSWORD
    ? { username: env.WEB_USERNAME, password: env.WEB_PASSWORD }
    : undefined,
  botToken: env.BOT_TOKEN,
  ownerId: env.OWNER_ID,
  port: env.PORT,
  dbPath: env.DB_PATH,
};
