import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";

import { logoutAction } from "@/app/auth-actions";
import { getCurrentUser } from "@/lib/server/session";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TabTrack",
  description: "Split expenses with friends",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TabTrack",
  },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={inter.className}>
        <div className="min-h-screen bg-slate-50">
          <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
            <div className="max-w-lg mx-auto px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <Link href="/" className="flex items-center gap-2 w-fit">
                  <div className="w-7 h-7 bg-green-600 rounded-lg flex items-center justify-center">
                    <span className="text-white text-xs font-bold">T</span>
                  </div>
                  <span className="font-semibold text-slate-900">TabTrack</span>
                </Link>

                {user ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500 hidden sm:inline">
                      {user.displayName ?? user.email}
                    </span>
                    <form action={logoutAction}>
                      <button
                        type="submit"
                        className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                      >
                        Sign Out
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-sm">
                    <Link href="/login" className="text-slate-600 hover:text-slate-900">
                      Sign In
                    </Link>
                    <Link href="/signup" className="text-green-600 hover:text-green-700">
                      Sign Up
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="max-w-lg mx-auto px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
