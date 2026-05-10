// CART-IT DATABASE CONNECTION SETUP
// This file connects the Cart-It backend server to the PostgreSQL database
// Cart-It stores users, groups, items, notifications, price history, and other application data inside PostgreSQL.
// without this db connection, the backend would not be able to save or retrieve any information

// What this code does:
  // Loads environment variables from the .env file
  // Creates a PostgreSQL database connection pool
  // Verifies that DATABASE_URL exists before starting
  // Tests the database connection when the server starts

import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

if (!process.env.DATABASE_URL)
{
  throw new Error("DATABASE_URL is not defined in .env");
}

// A connection pool keeps database connections reusable
// Improves performance instead of reconnecting every time

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Confirms that backend can communicate w/ PostgreSQL before handling request
pool.connect()
  .then((client) => {
    console.log("Connected to PostgreSQL successfully");
    client.release();
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });