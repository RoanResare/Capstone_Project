/* Read-only Firestore export; explicit, staged PostgreSQL import/verification.
 * Customer-bearing files MUST be outside the checkout. Never prints records,
 * document paths, connection strings or raw driver errors.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { COLLECTION_TABLES, RELATIONAL_COLLECTIONS, tableFor } = require("../src/database/collections");
const { encode } = require("../src/database/values");
const { loadEnvFiles, projectRoot } = require("../src/config/loadEnv");
loadEnvFiles();

function externalFile(filename) {
  if (!filename) throw new Error("Provide an absolute backup path outside the checkout.");
  const resolved = path.resolve(filename);
  const physical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  const relative = path.relative(fs.realpathSync(projectRoot), physical);
  if (!path.isAbsolute(filename) || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Backup and customer report paths must be outside the checkout.");
  return resolved;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function runtimeTable(documentPath) {
  const parts = documentPath.split("/");
  return parts.length === 2 && Object.hasOwn(COLLECTION_TABLES, parts[0]) ? { collection: parts[0], table: tableFor(parts[0]), id: parts[1] } : null;
}
async function exportFirestore(filename) {
  const output = externalFile(filename);
  // Configuration initializes Firebase Auth only as needed; the export always
  // uses the explicit Firestore instance, never the selected runtime adapter.
  require("../src/config/firebaseAdmin");
  const { getFirestore } = require("firebase-admin/firestore");
  const firestore = getFirestore();
  const stream = fs.createWriteStream(output, { flags: "wx", mode: 0o600 });
  await once(stream, "open");
  const hash = crypto.createHash("sha256");
  const counts = { documents: 0, runtimeDocuments: 0, archivedDocuments: 0, collections: {} };
  async function visit(collection) {
    // listDocuments includes missing ancestors with orphaned subcollections.
    const references = await collection.listDocuments();
    for (const reference of references) {
      const snapshot = await reference.get();
      if (snapshot.exists) {
        const row = { path: reference.path, data: encode(snapshot.data()) };
        const line = JSON.stringify(row) + "\n";
        hash.update(line);
        if (!stream.write(line)) await once(stream, "drain");
        counts.documents++;
        if (runtimeTable(row.path)) {
          counts.runtimeDocuments++;
          const name = row.path.split("/")[0];
          counts.collections[name] = (counts.collections[name] || 0) + 1;
        } else counts.archivedDocuments++;
      }
      for (const child of await reference.listCollections()) await visit(child);
    }
  }
  try {
    for (const collection of await firestore.listCollections()) await visit(collection);
    stream.end(); await once(stream, "finish");
    const manifest = { formatVersion: 1, exportedAt: new Date().toISOString(), ...counts, sha256: hash.digest("hex"),
      consistency: "Requires a write freeze or point-in-time source backup for cutover; this is a sequential read-only export." };
    await fsp.writeFile(output + ".manifest.json", JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    return manifest;
  } catch (error) { stream.destroy(); throw error; }
}
async function* readExport(filename) {
  const stream = fs.createReadStream(externalFile(filename));
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (typeof row.path !== "string" || row.path.split("/").length % 2 || row.path.split("/").some(part => !part || [".", ".."].includes(part)) ||
        !row.data || typeof row.data !== "object" || Array.isArray(row.data)) throw new Error("Invalid migration document.");
    yield row;
  }
}
async function assertManifest(filename) {
  const input = externalFile(filename);
  const manifest = JSON.parse(await fsp.readFile(input + ".manifest.json", "utf8"));
  if (manifest.formatVersion !== 1) throw new Error("Unsupported migration manifest.");
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(input)) hash.update(chunk);
  if (hash.digest("hex") !== manifest.sha256) throw new Error("Backup checksum does not match its manifest.");
  let count = 0;
  const seen = new Set();
  for await (const row of readExport(input)) {
    if (seen.has(row.path)) throw new Error("Duplicate document path in backup.");
    seen.add(row.path); count++;
  }
  if (count !== manifest.documents) throw new Error("Backup count does not match its manifest.");
  return manifest;
}
async function importRows(pool, filename) {
  const manifest = await assertManifest(filename);
  const client = await pool.connect();
  let imported = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [639721548]);
    for await (const row of readExport(filename)) {
      const target = runtimeTable(row.path);
      if (target && RELATIONAL_COLLECTIONS.has(target.collection)) {
        await client.query("SELECT app_private.upsert_relational_document($1,$2,$3::jsonb)", [target.collection, target.id, JSON.stringify(row.data)]);
      } else if (target) await client.query(`INSERT INTO ${target.table}(id,data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = clock_timestamp()`, [target.id, JSON.stringify(row.data)]);
      else await client.query("INSERT INTO app_private.firestore_archive(path,data) VALUES ($1,$2::jsonb) ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, imported_at = clock_timestamp()", [row.path, JSON.stringify(row.data)]);
      imported++;
    }
    await client.query("COMMIT");
    return { imported, sourceDocuments: manifest.documents, sourceChecksumVerified: true };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
async function validateRows(pool, filename) {
  const manifest = await assertManifest(filename);
  let verified = 0, missing = 0, mismatched = 0, unexpected = 0;
  const expected = new Map();
  for await (const row of readExport(filename)) {
    const target = runtimeTable(row.path);
    const key = target?.table || "app_private.firestore_archive";
    if (!expected.has(key)) expected.set(key, new Set());
    expected.get(key).add(target?.id || row.path);
    const result = target
      ? await pool.query(`SELECT data FROM ${target.table} WHERE id=$1`, [target.id])
      : await pool.query("SELECT data FROM app_private.firestore_archive WHERE path=$1", [row.path]);
    if (!result.rows.length) missing++;
    else if (digest(result.rows[0].data) !== digest(row.data)) mismatched++;
    else verified++;
  }
  for (const table of [...Object.keys(COLLECTION_TABLES).map(tableFor), "app_private.firestore_archive"]) {
    const rows = await pool.query(`SELECT ${table.endsWith("firestore_archive") ? "path" : "id"} AS key FROM ${table}`);
    for (const row of rows.rows) if (!expected.get(table)?.has(row.key)) unexpected++;
  }
  const relationships = await validateRelationships(pool);
  return { sourceDocuments: manifest.documents, verified, missing, mismatched, unexpected, relationships,
    valid: !missing && !mismatched && !unexpected && Object.values(relationships).every(count => count === 0) };
}
async function validateRelationships(pool) {
  const checks = {
    petsWithMissingOwners: "SELECT count(*) FROM app_private.pets_relational p WHERE coalesce(nullif(p.data->>'customerId',''),nullif(p.data->>'ownerId','')) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_private.users_relational u WHERE u.id=coalesce(nullif(p.data->>'customerId',''),nullif(p.data->>'ownerId','')) OR u.data->>'uid'=coalesce(nullif(p.data->>'customerId',''),nullif(p.data->>'ownerId','')))",
    appointmentsWithMissingPets: "SELECT count(*) FROM app_private.appointments_relational a WHERE nullif(a.data->>'petRecordId','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_private.pets_relational p WHERE p.id=a.data->>'petRecordId')",
    appointmentsWithMissingSlots: "SELECT count(*) FROM app_private.appointments a WHERE nullif(a.data->>'slotId','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_private.availability_slots s WHERE s.id=a.data->>'slotId')",
    usernamesWithMissingUsers: "SELECT count(*) FROM app_private.usernames n WHERE NOT EXISTS (SELECT 1 FROM app_private.users_relational u WHERE u.id=n.data->>'uid' OR u.data->>'uid'=n.data->>'uid')",
    duplicateEmails: "SELECT count(*) FROM (SELECT lower(data->>'email') FROM app_private.users_relational WHERE nullif(data->>'email','') IS NOT NULL GROUP BY lower(data->>'email') HAVING count(*)>1) d",
    duplicateUserIds: "SELECT count(*) FROM (SELECT data->>'uid' FROM app_private.users_relational WHERE nullif(data->>'uid','') IS NOT NULL GROUP BY data->>'uid' HAVING count(*)>1) d",
    invalidUserRoles: "SELECT count(*) FROM app_private.users_relational WHERE data ? 'role' AND lower(data->>'role') NOT IN ('admin','staff','customer')",
    invalidPetGenders: "SELECT count(*) FROM app_private.pets_relational WHERE data ? 'gender' AND data->>'gender' NOT IN ('Male','Female')",
    invalidSlotCapacities: "SELECT count(*) FROM app_private.availability_slots WHERE data ? 'capacity' AND CASE WHEN jsonb_typeof(data->'capacity')='number' THEN (data->>'capacity')::numeric < 1 OR trunc((data->>'capacity')::numeric) <> (data->>'capacity')::numeric ELSE true END",
  };
  const results = {};
  for (const [name, sql] of Object.entries(checks)) results[name] = Number((await pool.query(sql)).rows[0].count);
  return results;
}
async function main() {
  const [command, filename] = process.argv.slice(2);
  if (command === "export") return exportFirestore(filename);
  if (!["import", "validate", "schema"].includes(command)) throw new Error("Use export, schema, import or validate.");
  if (process.env.MIGRATION_TARGET !== "staging") throw new Error("MIGRATION_TARGET=staging is required. Production migration is not enabled by this tool.");
  if (!process.env.DATABASE_URL) throw new Error("Set the staging DATABASE_URL privately.");
  const { Pool } = require("pg");
  const { getConnectionString } = require("../src/database/postgres");
  const pool = new Pool({ connectionString: getConnectionString(process.env.DATABASE_URL), max: 2, connectionTimeoutMillis: 10000 });
  try {
    if (command === "schema") {
      for (const name of ["202610280001_business_data.sql", "202610280002_public_relational_tables.sql"]) {
        await pool.query(await fsp.readFile(path.join(projectRoot, "supabase/migrations", name), "utf8"));
      }
      return { schemaApplied: true, target: "staging" };
    }
    if (command === "import") return importRows(pool, filename);
    return validateRows(pool, filename);
  } finally { await pool.end(); }
}
if (require.main === module) main().then(report => { console.log(JSON.stringify(report, null, 2)); if (report.valid === false) process.exitCode = 1; })
  .catch(() => { console.error("Migration stopped. Check configuration, backup integrity and staging permissions; no credentials or record details are printed."); process.exitCode = 1; });
module.exports = { externalFile, canonical, digest, runtimeTable, exportFirestore, readExport, assertManifest, importRows, validateRows, validateRelationships };
