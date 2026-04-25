import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { getDatabaseConfig } from "./config";

const client = createClient(getDatabaseConfig(process.env));

export const db = drizzle(client, { schema });
