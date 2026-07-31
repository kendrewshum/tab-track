import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "@/db/schema";
import { authAttempts } from "@/db/schema";
import type {
  AuthAttemptRecord,
  AuthAttemptStore,
} from "@/lib/server/auth-rate-limit";

export function createAuthAttemptStore(
  database: LibSQLDatabase<typeof schema>,
): AuthAttemptStore {
  return {
    async find(bucketKeys): Promise<AuthAttemptRecord[]> {
      if (bucketKeys.length === 0) {
        return [];
      }

      return database
        .select()
        .from(authAttempts)
        .where(inArray(authAttempts.bucketKey, bucketKeys));
    },

    async reserve(buckets, now): Promise<AuthAttemptRecord[]> {
      if (buckets.length === 0) {
        return [];
      }

      const incrementQueries = buckets.map((bucket) => {
        const expiresAt = now + bucket.windowMs;
        return database
          .insert(authAttempts)
          .values({
            bucketKey: bucket.bucketKey,
            failureCount: 1,
            windowStartedAt: now,
            expiresAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: authAttempts.bucketKey,
            set: {
              failureCount: sql<number>`
                CASE
                  WHEN ${authAttempts.expiresAt} <= ${now} THEN 1
                  ELSE ${authAttempts.failureCount} + 1
                END
              `,
              windowStartedAt: sql<number>`
                CASE
                  WHEN ${authAttempts.expiresAt} <= ${now} THEN ${now}
                  ELSE ${authAttempts.windowStartedAt}
                END
              `,
              expiresAt: sql<number>`
                CASE
                  WHEN ${authAttempts.expiresAt} <= ${now} THEN ${expiresAt}
                  ELSE ${authAttempts.expiresAt}
                END
              `,
              updatedAt: now,
            },
          });
      });
      const readQuery = database
        .select()
        .from(authAttempts)
        .where(
          inArray(
            authAttempts.bucketKey,
            buckets.map(({ bucketKey }) => bucketKey),
          ),
        );
      const results = await database.batch([
        incrementQueries[0],
        ...incrementQueries.slice(1),
        readQuery,
      ]);

      return results[results.length - 1] as AuthAttemptRecord[];
    },

    async completeSuccess(buckets): Promise<void> {
      if (buckets.length === 0) {
        return;
      }

      await database.transaction(async (transaction) => {
        const scopedKeys = buckets
          .filter(({ kind }) => kind !== "source")
          .map(({ bucketKey }) => bucketKey);
        if (scopedKeys.length > 0) {
          await transaction
            .delete(authAttempts)
            .where(inArray(authAttempts.bucketKey, scopedKeys));
        }

        for (const { bucketKey, kind } of buckets) {
          if (kind !== "source") {
            continue;
          }
          await transaction
            .delete(authAttempts)
            .where(
              and(
                eq(authAttempts.bucketKey, bucketKey),
                eq(authAttempts.failureCount, 1),
              ),
            );
          await transaction
            .update(authAttempts)
            .set({
              failureCount: sql<number>`${authAttempts.failureCount} - 1`,
            })
            .where(
              and(
                eq(authAttempts.bucketKey, bucketKey),
                gt(authAttempts.failureCount, 1),
              ),
            );
        }
      });
    },

    async cleanupExpired(now, limit): Promise<number> {
      if (limit <= 0) {
        return 0;
      }

      const result = await database.run(sql`
        DELETE FROM ${authAttempts}
        WHERE ${authAttempts.bucketKey} IN (
          SELECT ${authAttempts.bucketKey}
          FROM ${authAttempts}
          WHERE ${authAttempts.expiresAt} <= ${now}
          ORDER BY ${authAttempts.expiresAt}
          LIMIT ${Math.floor(limit)}
        )
      `);
      return Number(result.rowsAffected);
    },
  };
}
