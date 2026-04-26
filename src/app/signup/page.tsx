import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/server/session";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  return (
    <div className="max-w-md mx-auto pt-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Create Account</h1>
          <p className="text-sm text-slate-500 mt-1">
            Use the shared invite code so only your crew gets into the app.
          </p>
        </div>
        <SignupForm />
      </div>
    </div>
  );
}
