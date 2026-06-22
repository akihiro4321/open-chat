import 'dotenv/config';

import path from 'node:path';

import { defineConfig } from 'prisma/config';

const defaultDatabaseUrl = `file:${path.resolve('prisma/open-chat.db')}`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
