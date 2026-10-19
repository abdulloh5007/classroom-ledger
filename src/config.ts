import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

// Secrets come ONLY from the local .env, never from client code or external env overrides.
const file = existsSync('.env') ? parse(readFileSync('.env')) : {};
const env = z
  .object({
    BOT_TOKEN: z.string().default(''),
    WEB_USERNAME: z.string().min(1).default('owner'),
    WEB_PASSWORD: z.string().default(''),
    OWNER_ID: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    ),
    PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
    DB_PATH: z.string().min(1).default('./data/app.db'),
  })
  .parse(file);
if (env.BOT_TOKEN && !env.OWNER_ID) throw new Error('Заполните OWNER_ID в .env');
if (env.WEB_PASSWORD && env.WEB_PASSWORD.length < 16)
  throw new Error('WEB_PASSWORD должен содержать минимум 16 символов');
export const config = {
  webAuth: env.WEB_PASSWORD
    ? { username: env.WEB_USERNAME, password: env.WEB_PASSWORD }
    : undefined,
  botToken: env.BOT_TOKEN,
  ownerId: env.OWNER_ID,
  port: env.PORT,
  dbPath: env.DB_PATH,
};
