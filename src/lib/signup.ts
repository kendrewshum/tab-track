type SignupInput = {
  email: string;
  displayName: string;
  password: string;
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

export function validateSignupInput(
  input: SignupInput,
  expectedInviteCode: string | undefined
): SignupSuccess | SignupFailure {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const password = input.password;
  const inviteCode = input.inviteCode.trim();

  if (!email || !email.includes("@")) {
    return { success: false, message: "Enter a valid email address." };
  }

  if (!displayName) {
    return { success: false, message: "Enter your name." };
  }

  if (password.length < 8) {
    return { success: false, message: "Password must be at least 8 characters." };
  }

  if (!expectedInviteCode || inviteCode !== expectedInviteCode) {
    return { success: false, message: "That invite code is not valid." };
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
