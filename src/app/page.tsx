import Link from "next/link";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";
import { sql, eq } from "drizzle-orm";

import { db } from "@/db";
import { groups, members } from "@/db/schema";
import { formatDate } from "@/lib/format";

export default async function HomePage() {
  const allGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      createdAt: groups.createdAt,
      memberCount: sql<number>`count(distinct ${members.id})`,
    })
    .from(groups)
    .leftJoin(members, eq(members.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(sql`${groups.createdAt} desc`);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Groups</h1>
        <Link
          href="/groups/new"
          className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
        >
          <Plus size={16} />
          New Group
        </Link>
      </div>

      {allGroups.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">💸</span>
          </div>
          <p className="text-slate-700 font-medium text-lg">No groups yet</p>
          <p className="text-slate-400 text-sm mt-1 mb-5">
            Create a group to start tracking shared expenses
          </p>
          <Link
            href="/groups/new"
            className="inline-flex items-center gap-1.5 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            Create your first group
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {allGroups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-4 hover:border-green-400 hover:shadow-sm transition-all"
            >
              <div>
                <p className="font-semibold text-slate-900">{group.name}</p>
                <p className="text-sm text-slate-400 mt-0.5">
                  {group.memberCount} member{group.memberCount !== 1 ? "s" : ""} ·{" "}
                  {formatDate(group.createdAt.split("T")[0])}
                </p>
              </div>
              <span className="text-slate-300 text-xl">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
