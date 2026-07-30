import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { GROUP_INVITATION_COOKIE_NAME } from "@/lib/server/group-invitation-cookie";
import { getCurrentUser } from "@/lib/server/session";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  const hasGroupInvitation = Boolean(
    (await cookies()).get(GROUP_INVITATION_COOKIE_NAME)?.value,
  );

  return (
    <div className="max-w-md mx-auto pt-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Create Account</h1>
          <p className="text-sm text-slate-500 mt-1">
            {hasGroupInvitation
              ? "Set up your account, then continue to your shared group."
              : "Use the shared invite code so only your crew gets into the app."}
          </p>
        </div>
        <SignupForm hasGroupInvitation={hasGroupInvitation} />
      </div>
    </div>
  );
}
