import { headers } from "next/headers";

type ResolveTrustedRequestSourceInput = {
  isVercel: boolean;
  vercelForwardedFor: string | null;
};

export function resolveTrustedRequestSource({
  isVercel,
  vercelForwardedFor,
}: ResolveTrustedRequestSourceInput): string | null {
  if (!isVercel || !vercelForwardedFor) {
    return null;
  }

  const source = vercelForwardedFor.split(",", 1)[0]?.trim();
  return source || null;
}

export async function getTrustedRequestSource(): Promise<string | null> {
  const requestHeaders = await headers();
  return resolveTrustedRequestSource({
    isVercel: Boolean(process.env.VERCEL),
    vercelForwardedFor: requestHeaders.get("x-vercel-forwarded-for"),
  });
}
