import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PgDb } from "./db/client.js";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional; deployment environments provide variables directly.
}

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const db = new PgDb(config.databaseUrl);
const app = buildApp({ db, config });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
