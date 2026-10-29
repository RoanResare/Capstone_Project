const fs = require("node:fs/promises");
const path = require("node:path");
const { downloadDisposableDomains } = require("../src/utils/disposableDomainList");

async function main() {
  const domains = await downloadDisposableDomains();
  const directory = path.resolve(__dirname, "../src/data");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "disposable-email-domains.json"), `${JSON.stringify(domains, null, 2)}\n`);
  console.info(`Updated bundled disposable email list: ${domains.length} domains.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
