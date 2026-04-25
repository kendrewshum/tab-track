"use client";

import { useMemo, useState } from "react";
import { createExpense } from "@/app/actions";
import { computeSplits } from "@/lib/splits";
import { formatCurrency, today } from "@/lib/format";

type Member = { id: string; name: string };
type SplitType = "equal" | "shares" | "percentage" | "exact";

export function ExpenseForm({ groupId, members }: { groupId: string; members: Member[] }) {
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState(members[0]?.id ?? "");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [participants, setParticipants] = useState<Set<string>>(
    new Set(members.map((m) => m.id))
  );
  const [shareValues, setShareValues] = useState<Record<string, string>>(
    Object.fromEntries(members.map((m) => [m.id, "1"]))
  );
  const [pctValues, setPctValues] = useState<Record<string, string>>(
    Object.fromEntries(members.map((m) => [m.id, ""]))
  );
  const [exactValues, setExactValues] = useState<Record<string, string>>(
    Object.fromEntries(members.map((m) => [m.id, ""]))
  );

  const participantList = members.filter((m) => participants.has(m.id));
  const numericAmount = parseFloat(amount) || 0;

  const toggleParticipant = (id: string) => {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const splits = useMemo(() => {
    if (numericAmount <= 0 || participantList.length === 0) return [];
    const ids = participantList.map((m) => m.id);
    const entries = computeSplits(
      splitType,
      numericAmount,
      ids,
      {
        shares: Object.fromEntries(ids.map((id) => [id, parseFloat(shareValues[id]) || 0])),
        percentages: Object.fromEntries(ids.map((id) => [id, parseFloat(pctValues[id]) || 0])),
        exact: Object.fromEntries(ids.map((id) => [id, parseFloat(exactValues[id]) || 0])),
      },
      paidById
    );
    return entries.map((e, i) => ({ ...e, name: participantList[i].name }));
  }, [splitType, numericAmount, participantList, shareValues, pctValues, exactValues, paidById]);

  const splitTotal = splits.reduce((s, x) => s + x.amount, 0);
  const pctTotal = participantList.reduce((s, m) => s + (parseFloat(pctValues[m.id]) || 0), 0);

  const isValid =
    numericAmount > 0 &&
    splits.length > 0 &&
    (splitType === "equal" || splitType === "shares"
      ? true
      : splitType === "percentage"
      ? Math.abs(pctTotal - 100) < 0.01
      : Math.abs(splitTotal - numericAmount) < 0.01);

  const action = createExpense.bind(null, groupId);

  return (
    <form action={action} className="space-y-5">
      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
        <input
          name="description"
          required
          placeholder="e.g. Dinner, Hotel, Uber"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      {/* Amount + Date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount ($)</label>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Date</label>
          <input
            name="date"
            type="date"
            required
            defaultValue={today()}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Paid by */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Paid by</label>
        <select
          name="paidById"
          required
          value={paidById}
          onChange={(e) => setPaidById(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Split type */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Split method</label>
        <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-lg">
          {(["equal", "shares", "percentage", "exact"] as SplitType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSplitType(t)}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                splitType === t
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "equal" ? "Equally" : t === "shares" ? "Shares" : t === "percentage" ? "%" : "Exact"}
            </button>
          ))}
        </div>
        <input type="hidden" name="splitType" value={splitType} />
      </div>

      {/* Per-member split inputs */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          {splitType === "equal" && "Who's included?"}
          {splitType === "shares" && "Shares per person"}
          {splitType === "percentage" && "Percentage per person"}
          {splitType === "exact" && "Exact amount per person"}
        </label>
        <div className="space-y-2">
          {members.map((member) => {
            const isIn = participants.has(member.id);
            const split = splits.find((s) => s.memberId === member.id);
            return (
              <div
                key={member.id}
                className={`border rounded-xl p-3 transition-all ${
                  isIn ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleParticipant(member.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isIn ? "bg-green-600 border-green-600" : "border-slate-300 bg-white"
                    }`}
                  >
                    {isIn && <span className="text-white text-[10px] font-bold">✓</span>}
                  </button>
                  {isIn && <input type="hidden" name="participants" value={member.id} />}

                  <span className="text-sm font-medium text-slate-800 flex-1">{member.name}</span>

                  {isIn && (
                    <div className="flex items-center gap-1.5">
                      {splitType === "shares" && (
                        <>
                          <input
                            type="number"
                            name={`share_${member.id}`}
                            min="0"
                            step="0.5"
                            value={shareValues[member.id]}
                            onChange={(e) =>
                              setShareValues((p) => ({ ...p, [member.id]: e.target.value }))
                            }
                            className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                          <span className="text-xs text-slate-400">shares</span>
                        </>
                      )}
                      {splitType === "percentage" && (
                        <>
                          <input
                            type="number"
                            name={`pct_${member.id}`}
                            min="0"
                            max="100"
                            step="1"
                            value={pctValues[member.id]}
                            onChange={(e) =>
                              setPctValues((p) => ({ ...p, [member.id]: e.target.value }))
                            }
                            className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                          <span className="text-xs text-slate-400">%</span>
                        </>
                      )}
                      {splitType === "exact" && (
                        <>
                          <span className="text-xs text-slate-400">$</span>
                          <input
                            type="number"
                            name={`exact_${member.id}`}
                            min="0"
                            step="0.01"
                            value={exactValues[member.id]}
                            onChange={(e) =>
                              setExactValues((p) => ({ ...p, [member.id]: e.target.value }))
                            }
                            className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-green-500"
                          />
                        </>
                      )}
                      {(splitType === "equal" || (split && numericAmount > 0)) && (
                        <span className="text-sm text-slate-500 min-w-[52px] text-right">
                          {split ? formatCurrency(split.amount) : "—"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Validation feedback */}
      {numericAmount > 0 && splits.length > 0 && splitType === "percentage" && (
        <div
          className={`text-sm rounded-lg px-3 py-2 ${
            Math.abs(pctTotal - 100) < 0.01
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}
        >
          {pctTotal.toFixed(1)}% assigned
          {Math.abs(pctTotal - 100) >= 0.01 && ` — need ${(100 - pctTotal).toFixed(1)}% more`}
        </div>
      )}
      {numericAmount > 0 && splits.length > 0 && splitType === "exact" && (
        <div
          className={`text-sm rounded-lg px-3 py-2 ${
            Math.abs(splitTotal - numericAmount) < 0.01
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}
        >
          {formatCurrency(splitTotal)} of {formatCurrency(numericAmount)} assigned
          {Math.abs(splitTotal - numericAmount) >= 0.01 &&
            ` (${formatCurrency(Math.abs(numericAmount - splitTotal))} ${
              splitTotal < numericAmount ? "remaining" : "over"
            })`}
        </div>
      )}

      <button
        type="submit"
        disabled={!isValid}
        className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add Expense
      </button>
    </form>
  );
}
