import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { TabTrackLogo } from "@/components/tab-track-logo";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TabTrack",
  description: "Split expenses with friends",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/tabtrack-mark.svg", type: "image/svg+xml" }],
    shortcut: ["/tabtrack-mark.svg"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-slate-50">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
            <div className="mx-auto max-w-lg px-4 py-3">
              <Link href="/" className="flex w-fit items-center gap-2">
                <TabTrackLogo decorative className="h-7 w-7 shrink-0" />
                <span className="font-semibold text-slate-900">TabTrack</span>
              </Link>
            </div>
          </header>
          <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
