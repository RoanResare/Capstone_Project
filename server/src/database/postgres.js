const { randomBytes } = require("node:crypto");
const { tableFor, RELATIONAL_COLLECTIONS } = require("./collections");
const { TYPE, encode, decode, deepMerge } = require("./values");

// All app writes acquire the same transaction lock. READ COMMITTED plus this
// lock gives each booking/uniqueness callback a fresh, serial write view across
// server replicas; a second booking cannot pass a stale capacity check.
const WRITE_LOCK = 639721548;
function validId(id) {
  if (typeof id !== "string" || !id || id.includes("/") || [".", ".."].includes(id)) throw new Error("Invalid document ID.");
  return id;
}
function createPostgresDatabase(pool) {
  const database = {
    provider: "postgres",
    collection(name) { tableFor(name); return new Query(name); },
    doc(path) { const parts = path.split("/"); if (parts.length !== 2) throw new Error("Archived subcollections are not runtime collections."); return database.collection(parts[0]).doc(parts[1]); },
    async getAll(...references) { return Promise.all(references.map(reference => read(reference, pool))); },
    batch() { return writeBuffer(); },
    async runTransaction(callback) {
      for (let attempt = 0; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL statement_timeout = '15s'");
          await client.query("SET LOCAL lock_timeout = '10s'");
          await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
          const transaction = writeBuffer(client);
          const result = await callback(transaction);
          await transaction.flush();
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          if (attempt < 4 && ["40001", "40P01"].includes(error.code)) continue;
          throw error;
        } finally { client.release(); }
      }
    },
    close: () => pool.end(),
  };
  function snapshot(collection, row) {
    const reference = new Reference(collection, row?.id || "missing");
    return { id: row?.id, ref: reference, exists: Boolean(row), data: () => row ? decode(row.data, database) : undefined,
      get: field => row ? field.split(".").reduce((value, key) => value?.[key], decode(row.data, database)) : undefined };
  }
  class Reference {
    constructor(collection, id) { this.collectionName = collection; this.id = validId(id); this.path = `${collection}/${id}`; Object.defineProperty(this, "_postgresDatabase", { value: database }); }
    async get() { return read(this, pool); }
    async set(data, options) { return database.runTransaction(tx => { tx.set(this, data, options); }); }
    async update(data) { return database.runTransaction(tx => { tx.update(this, data); }); }
    async delete() { return database.runTransaction(tx => { tx.delete(this); }); }
  }
  class Query {
    constructor(collection, filters = [], orders = [], count, cursor) { Object.assign(this, { collectionName: collection, filters, orders, count, cursor }); }
    doc(id = randomBytes(15).toString("base64url")) { return new Reference(this.collectionName, id); }
    where(field, op, value) { return new Query(this.collectionName, [...this.filters, { field, op, value }], this.orders, this.count, this.cursor); }
    orderBy(field, direction = "asc") { if (!["asc", "desc"].includes(direction)) throw new Error("Invalid query order."); return new Query(this.collectionName, this.filters, [...this.orders, { field, direction }], this.count, this.cursor); }
    limit(count) { if (!Number.isInteger(count) || count < 1) throw new Error("Invalid query limit."); return new Query(this.collectionName, this.filters, this.orders, count, this.cursor); }
    startAfter(...cursor) { return new Query(this.collectionName, this.filters, this.orders, this.count, cursor); }
    async get() { return read(this, pool); }
  }
  function compile(reference) {
    const params = [];
    const bind = value => { params.push(value); return `$${params.length}`; };
    const conditions = [];
    const expression = field => {
      if (field === "__name__") return 'id COLLATE "C"';
      if (typeof field !== "string" || !/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(field)) throw new Error("Unsupported query field.");
      // Field names are strictly validated above; stable expressions allow indexes.
      return `(data #> '{${field.split(".").join(",")}}')`;
    };
    if (reference instanceof Reference) conditions.push(`id = ${bind(reference.id)}`);
    else {
      for (const { field, op, value } of reference.filters) {
        const expr = expression(field);
        const encoded = field === "__name__" ? value : encode(value);
        if (op === "in") {
          if (!Array.isArray(value) || !value.length) throw new Error("Invalid in query.");
          conditions.push(`${expr} IN (${value.map(item => field === "__name__" ? bind(item) : `${bind(JSON.stringify(encode(item)))}::jsonb`).join(",")})`);
        } else if (["==", "!=", "<", "<=", ">", ">="].includes(op)) {
          const sqlOp = op === "==" ? "=" : op === "!=" ? "<>" : op;
          if (encoded?.[TYPE] === "timestamp") {
            conditions.push(`((${expr}->>'seconds')::numeric * 1000000000 + (${expr}->>'nanoseconds')::numeric) ${sqlOp} ${bind(String(BigInt(encoded.seconds) * 1000000000n + BigInt(encoded.nanoseconds))) }::numeric`);
          } else conditions.push(`${expr} ${sqlOp} ${field === "__name__" ? bind(encoded) : `${bind(JSON.stringify(encoded))}::jsonb`}`);
        } else if (op === "array-contains") conditions.push(`${expr} @> ${bind(JSON.stringify([encode(value)]))}::jsonb`);
        else throw new Error("Unsupported database query operator.");
      }
      const orders = reference.orders.length ? [...reference.orders] : [{ field: "__name__", direction: "asc" }];
      if (!orders.some(order => order.field === "__name__")) orders.push({ field: "__name__", direction: orders.at(-1).direction });
      for (const order of orders) if (order.field !== "__name__") conditions.push(`${expression(order.field)} IS NOT NULL`);
      if (reference.cursor) {
        const first = reference.cursor[0];
        const isSnapshot = typeof first?.data === "function";
        const cursorOrders = isSnapshot ? orders : orders.slice(0, reference.cursor.length);
        const values = cursorOrders.map((order, index) => isSnapshot ? order.field === "__name__" ? first.id : first.get(order.field) : reference.cursor[index]);
        const clauses = cursorOrders.map((order, index) => {
          const equal = cursorOrders.slice(0, index).map((prior, i) => `${expression(prior.field)} = ${prior.field === "__name__" ? bind(values[i]) : `${bind(JSON.stringify(encode(values[i])))}::jsonb`}`);
          const value = order.field === "__name__" ? bind(values[index]) : `${bind(JSON.stringify(encode(values[index])))}::jsonb`;
          return `(${[...equal, `${expression(order.field)} ${order.direction === "desc" ? "<" : ">"} ${value}`].join(" AND ")})`;
        });
        conditions.push(`(${clauses.join(" OR ")})`);
      }
      const sql = `SELECT id, data FROM ${tableFor(reference.collectionName)}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${orders.map(order => `${expression(order.field)} ${order.direction.toUpperCase()}`).join(", ")}${reference.count ? " LIMIT " + bind(reference.count) : ""}`;
      return { text: sql, values: params };
    }
    return { text: `SELECT id, data FROM ${tableFor(reference.collectionName)} WHERE ${conditions.join(" AND ")}`, values: params };
  }
  async function read(reference, client) {
    const { text, values } = compile(reference);
    const { rows } = await client.query(text, values);
    if (reference instanceof Reference) {
      if (!rows[0]) return { id: reference.id, ref: reference, exists: false, data: () => undefined, get: () => undefined };
      return snapshot(reference.collectionName, rows[0]);
    }
    const docs = rows.map(row => snapshot(reference.collectionName, row));
    return { docs, empty: !docs.length, size: docs.length, forEach: callback => docs.forEach(callback) };
  }
  function writeBuffer(client) {
    const writes = [];
    const buffer = {
      get: reference => read(reference, client || pool),
      getAll: (...references) => Promise.all(references.map(reference => read(reference, client || pool))),
      set(reference, data, options = {}) { writes.push({ reference, data: encode(data), merge: options.merge === true }); return buffer; },
      update(reference, data) { writes.push({ reference, data: encode(data), update: true }); return buffer; },
      delete(reference) { writes.push({ reference, remove: true }); return buffer; },
      async flush() {
        for (const write of writes) {
          const table = tableFor(write.reference.collectionName), id = write.reference.id;
          if (write.remove) {
            if (RELATIONAL_COLLECTIONS.has(write.reference.collectionName)) {
              await client.query("SELECT app_private.delete_relational_document($1,$2)", [write.reference.collectionName, id]);
            } else await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
            continue;
          }
          let data = write.data;
          if (write.merge || write.update) {
            const previous = await client.query(`SELECT data FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
            if (write.update && !previous.rows.length) throw Object.assign(new Error("Document does not exist."), { code: "not-found" });
            data = write.merge ? deepMerge(previous.rows[0]?.data || {}, data) : { ...previous.rows[0]?.data, ...data };
          }
          if (RELATIONAL_COLLECTIONS.has(write.reference.collectionName)) {
            await client.query("SELECT app_private.upsert_relational_document($1,$2,$3::jsonb)", [write.reference.collectionName, id, JSON.stringify(data)]);
          } else {
            await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`, [id, JSON.stringify(data)]);
          }
        }
      },
      async commit() {
        if (client) throw new Error("Transactions commit at the database boundary.");
        return database.runTransaction(tx => { tx.copy(writes); });
      },
      copy(entries) { writes.push(...entries); },
    };
    return buffer;
  }
  database.compile = compile;
  return database;
}
function getPostgresDatabase() {
  const { Pool } = require("pg");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the PostgreSQL provider.");
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX || 5),
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 15000, query_timeout: 20000 });
  pool.on("error", () => console.error("[postgres] An idle database connection failed."));
  return createPostgresDatabase(pool);
}
module.exports = { createPostgresDatabase, getPostgresDatabase, WRITE_LOCK };
