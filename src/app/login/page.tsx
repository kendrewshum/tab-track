import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { GROUP_INVITATION_COOKIE_NAME } from "@/lib/server/group-invitation-cookie";
import { getCurrentUser } from "@/lib/server/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  const hasGroupInvitation = Boolean(
    (await cookies()).get(GROUP_INVITATION_COOKIE_NAME)?.value,
  );
  if (user) {
    redirect(hasGroupInvitation ? "/invite/claim" : "/");
  }

  return (
    <div className="max-w-md mx-auto pt-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sign In</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sign in to see the groups that belong to you.
          </p>
        </div>
        <LoginForm hasGroupInvitation={hasGroupInvitation} />
      </div>
    </div>
  );
}
