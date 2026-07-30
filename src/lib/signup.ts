type SignupProfileInput = {
  email: string;
  displayName: string;
  password: string;
};

type SignupInput = SignupProfileInput & {
  inviteCode: string;
};

type SignupSuccess = {
  success: true;
  data: {
    email: string;
    displayName: string;
    password: string;
  };
};

type SignupFailure = {
  success: false;
  message: string;
};

const SIGNUP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSignupProfile(
  input: SignupProfileInput,
): SignupSuccess | SignupFailure {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const password = input.password;

  if (!SIGNUP_EMAIL_PATTERN.test(email)) {
    return { success: false, message: "Enter a valid email address." };
  }

  if (!displayName) {
    return { success: false, message: "Enter your name." };
  }

  if (password.length < 8) {
    return { success: false, message: "Password must be at least 8 characters." };
  }

  return {
    success: true,
    data: {
      email,
      displayName,
      password,
    },
  };
}

export function validateSignupInput(
  input: SignupInput,
  expectedInviteCode: string | undefined,
  options: { alternativeInviteAuthorized?: boolean } = {},
): SignupSuccess | SignupFailure {
  const profile = validateSignupProfile(input);
  if (!profile.success) {
    return profile;
  }

  const inviteCode = input.inviteCode.trim();
  if (
    !options.alternativeInviteAuthorized &&
    (!expectedInviteCode || inviteCode !== expectedInviteCode)
  ) {
    return { success: false, message: "That invite code is not valid." };
  }

  return profile;
}
