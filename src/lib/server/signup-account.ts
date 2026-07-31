import type {
  AuthRateLimitAttempt,
  AuthRateLimitReservation,
} from "@/lib/server/auth-rate-limit";
import { validateSignupInput } from "@/lib/signup";

export const SIGNUP_UNAVAILABLE_MESSAGE =
  "We could not create an account with those details. Check them or try again later.";

type SignupAccountInput = {
  email: string;
  displayName: string;
  password: string;
  inviteCode: string;
  expectedInviteCode: string | undefined;
  source: string | null;
};

type SignupAccountDependencies = {
  limiter: {
    reserve(attempt: AuthRateLimitAttempt): Promise<{
      allowed: boolean;
      reservation: AuthRateLimitReservation;
      retryAfterSeconds?: number;
    }>;
    succeed(reservation: AuthRateLimitReservation): Promise<void>;
  };
  findUserByEmail(email: string): Promise<unknown | null>;
  hashPassword(password: string): Promise<string>;
  createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<unknown>;
};

type SignupAccountResult =
  | {
      success: true;
      data: {
        email: string;
        displayName: string;
        password: string;
      };
    }
  | {
      success: false;
      message: string;
    };

export async function createSignupAccountAttempt(
  input: SignupAccountInput,
  dependencies: SignupAccountDependencies,
): Promise<SignupAccountResult> {
  const attempt: AuthRateLimitAttempt = {
    action: "signup",
    identity: input.email.trim().toLowerCase(),
    source: input.source,
  };
  const limit = await dependencies.limiter.reserve(attempt);
  if (!limit.allowed) {
    return { success: false, message: SIGNUP_UNAVAILABLE_MESSAGE };
  }

  const validation = validateSignupInput(
    {
      email: input.email,
      displayName: input.displayName,
      password: input.password,
      inviteCode: input.inviteCode,
    },
    input.expectedInviteCode,
  );
  if (!validation.success) {
    return { success: false, message: validation.message };
  }

  try {
    const existingUser = await dependencies.findUserByEmail(
      validation.data.email,
    );
    if (existingUser) {
      return { success: false, message: SIGNUP_UNAVAILABLE_MESSAGE };
    }

    const passwordHash = await dependencies.hashPassword(
      validation.data.password,
    );
    await dependencies.createUser({
      email: validation.data.email,
      displayName: validation.data.displayName,
      passwordHash,
    });
  } catch {
    return { success: false, message: SIGNUP_UNAVAILABLE_MESSAGE };
  }

  await dependencies.limiter.succeed(limit.reservation);
  return {
    success: true,
    data: {
      email: validation.data.email,
      displayName: validation.data.displayName,
      password: validation.data.password,
    },
  };
}
