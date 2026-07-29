import { headers } from "next/headers";

type ResolveTrustedRequestSourceInput = {
  isVercel: boolean;
  forwardedFor: string | null;
};

export function resolveTrustedRequestSource({
  isVercel,
  forwardedFor,
}: ResolveTrustedRequestSourceInput): string | null {
  if (!isVercel || !forwardedFor) {
    return null;
  }

  const source = forwardedFor.split(",", 1)[0]?.trim();
  return source || null;
}

export async function getTrustedRequestSource(): Promise<string | null> {
  const requestHeaders = await headers();
  return resolveTrustedRequestSource({
    isVercel: Boolean(process.env.VERCEL),
    forwardedFor: requestHeaders.get("x-forwarded-for"),
  });
}
