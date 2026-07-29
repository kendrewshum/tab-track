import { NextResponse } from "next/server";

type DatabaseReadinessCheck = () => Promise<void>;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export function createReadinessHandler(
  checkDatabase: DatabaseReadinessCheck
) {
  return async function GET() {
    try {
      await checkDatabase();
      return NextResponse.json(
        { status: "ready" },
        { headers: RESPONSE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { status: "unavailable" },
        { status: 503, headers: RESPONSE_HEADERS }
      );
    }
  };
}
