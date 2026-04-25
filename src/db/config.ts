type DatabaseEnv = NodeJS.ProcessEnv;

type DatabaseConfig = {
  url: string;
  authToken?: string;
};

const LOCAL_SQLITE_URL = "file:local.db";

/**
 * Centralize database configuration so local development can use SQLite while
 * Vercel deployments fail fast unless the shared Turso database is configured.
 */
export function getDatabaseConfig(env: DatabaseEnv): DatabaseConfig {
  if (env.TURSO_DATABASE_URL) {
    return {
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    };
  }

  if (!env.VERCEL) {
    return {
      url: LOCAL_SQLITE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    };
  }

  const deploymentType = env.VERCEL_ENV ?? "production";
  throw new Error(
    `Missing TURSO_DATABASE_URL for Vercel ${deploymentType} deployments. ` +
      "Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to the matching Vercel environment."
  );
}
