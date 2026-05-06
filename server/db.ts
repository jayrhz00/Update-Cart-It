/**
 * PostgreSQL connection for the Cart-It API (student-friendly overview)
 *
 * WHAT THIS FILE IS FOR
 *   Every route in `index.ts` that needs data eventually runs SQL through `pool`
 *   (import: `import { pool } from "./db"`). Think of `pool` as the shared door to your database.
 *
 * WHY A "POOL" INSTEAD OF ONE CONNECTION?
 *   Opening a real network connection to Postgres is slow. A pool keeps a few connections
 *   ready and hands them to your code when a request arrives, then recycles them. That is
 *   normal in production APIs.
 *
 * WHY WE THROW IF DATABASE_URL IS MISSING
 *   Without a valid connection string the server cannot save users or items. Failing fast
 *   at startup is clearer than mysterious errors on the first login.
 *
 * WHAT THE `pool.connect()` BLOCK BELOW DOES
 *   When Node loads this file, we borrow one client, log success, then `client.release()`.
 *   Releasing puts the client back in the pool (it does NOT close the whole database).
 *   If the URL/password/database name is wrong, you see the error in the terminal immediately.
 */
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

if (!process.env.DATABASE_URL)
{
  throw new Error("DATABASE_URL is not defined in .env");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect()
  .then((client) => {
    console.log("Connected to PostgreSQL successfully");
    client.release();
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });