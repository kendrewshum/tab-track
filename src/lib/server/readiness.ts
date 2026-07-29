import { sql } from "drizzle-orm";

export async function checkDatabaseReadiness(): Promise<void> {
  const [{ db }, { users }] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
  ]);

  await db.select({ ready: sql<number>`1` }).from(users).limit(1);
}
