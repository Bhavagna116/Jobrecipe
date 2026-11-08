import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config();
import { databaseUrl } from '../config/urls.js';
import { pool } from './pool.js';

const connectionString = (typeof databaseUrl === 'function' ? databaseUrl() : null) || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!connectionString) {
  console.warn('[Prisma] No DATABASE_URL / DATABASE_PUBLIC_URL set.');
}

// Reuse the application's tuned pg pool when it exists. Sharing it means Prisma
// benefits from the warm, keep-alive connections and we do not open a second
// pool that pays its own cold-connect cost on the first interview request.
const adapter = new PrismaPg(
  pool || { connectionString },
  { disposeExternalPool: false }
);

// Global Prisma Client singleton
const globalForPrisma = global;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
