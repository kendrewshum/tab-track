import Link from "next/link";

export default function NotFound() {
  return (
    <div className="text-center py-16">
      <p className="text-5xl font-bold text-slate-200">404</p>
      <p className="text-slate-500 mt-3 mb-6">Page not found</p>
      <Link href="/" className="text-brand-600 font-medium hover:text-brand-700">
        ← Go home
      </Link>
    </div>
  );
}
