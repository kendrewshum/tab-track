import type {
  AuthRateLimitAttempt,
  AuthRateLimitReservation,
} from "@/lib/server/auth-rate-limit";

export const DUMMY_PASSWORD_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

type CredentialsUser = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
};

type CredentialsAuthorizeDependencies = {
  limiter: {
    reserve(attempt: AuthRateLimitAttempt): Promise<{
      allowed: boolean;
      reservation: AuthRateLimitReservation;
      retryAfterSeconds?: number;
    }>;
    succeed(reservation: AuthRateLimitReservation): Promise<void>;
  };
  findUserByEmail(email: string): Promise<CredentialsUser | null>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
  syncLegacyAccess(user: { id: string; email: string }): Promise<void>;
};

type CredentialsAuthorizeInput = {
  credentials: Partial<Record<"email" | "password", unknown>>;
  source: string | null;
};

export async function authorizeCredentialsAttempt(
  input: CredentialsAuthorizeInput,
  dependencies: CredentialsAuthorizeDependencies,
): Promise<{ id: string; email: string; name: string } | null> {
  const email =
    typeof input.credentials.email === "string"
      ? input.credentials.email.trim().toLowerCase()
      : "";
  const password =
    typeof input.credentials.password === "string"
      ? input.credentials.password
      : "";
  const attempt: AuthRateLimitAttempt = {
    action: "login",
    identity: email,
    source: input.source,
  };

  const limit = await dependencies.limiter.reserve(attempt);
  if (!limit.allowed) {
    return null;
  }

  if (!email || !password) {
    return null;
  }

  const user = await dependencies.findUserByEmail(email);
  const passwordMatches = await dependencies.verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !passwordMatches) {
    return null;
  }

  await dependencies.syncLegacyAccess({ id: user.id, email: user.email });
  await dependencies.limiter.succeed(limit.reservation);

  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
  };
}
