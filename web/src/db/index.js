import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

let db = null

if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL)
  db = drizzle(sql, { schema })
}

export { db }
