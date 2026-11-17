const fs = require("node:fs");
const path = require("node:path");
const { COLLECTION_TABLES } = require("../src/database/collections");
const root = path.resolve(__dirname, "../..");
const sites = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) {
      let enclosing = "module";
      fs.readFileSync(absolute, "utf8").split(/\r?\n/).forEach((line, index) => {
        const declaration = line.match(/(?:async\s+)?function\s+(\w+)\s*\(/) || line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
        if (declaration) enclosing = declaration[1];
        const methods = [...line.matchAll(/\b(collection|collectionGroup|doc|getDoc|getDocFromCache|getDocs|setDoc|updateDoc|deleteDoc|writeBatch|onSnapshot|runTransaction|batch|getAll|where|orderBy|startAfter|serverTimestamp|arrayUnion|deleteField)\s*\(/g)].map(match => match[1]);
        if (methods.length || /from ["']firebase\/(firestore|storage|functions)|require\(["']firebase-admin/.test(line)) {
          sites.push({ file: path.relative(root, absolute).replaceAll("\\", "/"), line: index + 1, nearestDeclaration: enclosing, operations: [...new Set(methods)] });
        }
      });
    }
  }
}
for (const directory of ["src", "server/src", "server/scripts"]) walk(path.join(root, directory));
const output = path.join(root, "docs/postgres-migration/database-call-inventory.json");
fs.writeFileSync(output, JSON.stringify({ note: "Static call-site inventory; nearestDeclaration is a navigation hint, not AST scope resolution. Runtime collections are allowlisted; export discovers unreferenced subcollections too.", tables: COLLECTION_TABLES, sites }, null, 2) + "\n");
console.log(JSON.stringify({ sourceCallSites: sites.length, collectionTables: Object.keys(COLLECTION_TABLES).length }));
