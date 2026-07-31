import { checkDatabaseReadiness } from "@/lib/server/readiness";
import { createReadinessHandler } from "./handler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = createReadinessHandler(checkDatabaseReadiness);
