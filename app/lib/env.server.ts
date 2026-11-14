import { existsSync } from "node:fs";

// ─── .env ───
// Loads .env into process.env once, if the file exists, with Node's built-in
// loader (no dotenv). Variables that are already set win. The modules that
// need .env values (knock.server.ts, scripts/knock-setup.ts) call it, so it
// works under both `react-router dev` and `react-router-serve`. It never loads
// under vitest: tests must not pick up real keys.

let loaded = false;

export function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  if (process.env.VITEST) return;
  if (existsSync(".env")) process.loadEnvFile(".env");
}
