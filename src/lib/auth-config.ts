export type AuthConfigEnv = {
  AUTH_SECRET?: string;
  APP_INVITE_CODE?: string;
};

export function getAuthConfigError(env: AuthConfigEnv): string | null {
  if (!env.AUTH_SECRET) {
    return "Authentication is not configured yet. Add AUTH_SECRET in Vercel.";
  }

  if (!env.APP_INVITE_CODE) {
    return "Signup is not configured yet. Add APP_INVITE_CODE in Vercel.";
  }

  return null;
}

export function isAuthSecretConfigured(env: { AUTH_SECRET?: string }): boolean {
  return Boolean(env.AUTH_SECRET);
}
