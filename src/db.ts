import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from './generated/prisma/client.js'

/*
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
})
*/

/*
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
})
*/

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL })

declare global {
  var __prisma: PrismaClient | undefined
}

export const prisma = globalThis.__prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

