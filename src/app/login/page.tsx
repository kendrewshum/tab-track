import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
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
        <LoginForm />
      </div>
    </div>
  );
}
