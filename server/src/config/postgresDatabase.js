const provider = (process.env.DATABASE_PROVIDER || "postgres").trim().toLowerCase();
if (provider !== "postgres") {
  throw new Error("DATABASE_PROVIDER=postgres is required.");
}
const db = require("../database/postgres").getPostgresDatabase();

module.exports = { db };
