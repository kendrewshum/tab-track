import type { Config } from "drizzle-kit";
import { getDatabaseConfig } from "./src/db/config";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: getDatabaseConfig(process.env),
} satisfies Config;
