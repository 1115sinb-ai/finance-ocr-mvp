"use client";

import Link from "next/link";
import { useMemo, useState, useCallback } from "react";

type TransactionType = "수입" | "지출";

type SavedTransactionItem = {
  date: string;
  occurredDate: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  note: string;
  savedAt: string;
};

const LOCAL_STORAGE_KEY = "finance-ocr-confirmed-transactions";
const CATEGORY_OPTIONS = [
  "매출",
  "기타수익",
  "매출원가",
  "급여",
  "복리후생비",
  "여비교통비",
  "통신비",
  "광고선전비",
  "접대비",
  "소모품비",
  "임차료",
  "지급수수료",
  "세금과공과",
  "기타비용",
] as const;

function normalizeDateInput(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeSavedItem(item: Partial<SavedTransactionItem>): SavedTransactionItem {
  return {
    date: normalizeDateInput(item.date ?? ""),
    occurredDate: normalizeDateInput(item.occurredDate ?? item.date ?? ""),
    description: item.description ?? "",
    amount: Number(item.amount ?? 0),
    type: item.type === "수입" ? "수입" : "지출",
    category: item.category ?? "",
    note: item.note ?? "",
    savedAt: item.savedAt ?? new Date().toISOString(),
  };
}

export default function SavedPage() {
  const [savedHistory, setSavedHistory] = useState<SavedTransactionItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<SavedTransactionItem>[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeSavedItem);
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState<string>("");

  const persist = useCallback((nextItems: SavedTransactionItem[]) => {
    setSavedHistory(nextItems);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextItems));
  }, []);

  const handleEdit = useCallback(
    (
      index: number,
      field: "date" | "occurredDate" | "description" | "amount" | "type" | "category" | "note",
      value: string,
    ) => {
      const next = savedHistory.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (field === "amount") {
          const amount = Number(value) || 0;
          const type: TransactionType = amount > 0 ? "수입" : amount < 0 ? "지출" : item.type;
          return { ...item, amount, type };
        }
        if (field === "type") {
          return { ...item, type: value === "수입" ? "수입" : "지출" };
        }
        if (field === "date" || field === "occurredDate") {
          return { ...item, [field]: normalizeDateInput(value) };
        }
        return { ...item, [field]: value };
      });
      persist(next);
      setMessage("저장된 내역을 수정했습니다.");
    },
    [persist, savedHistory],
  );

  const handleDelete = useCallback(
    (index: number) => {
      const next = savedHistory.filter((_, itemIndex) => itemIndex !== index);
      persist(next);
      setMessage("선택한 저장 내역 1건을 삭제했습니다.");
    },
    [persist, savedHistory],
  );

  const monthlySummary = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const item of savedHistory) {
      const month = normalizeDateInput(item.occurredDate).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!map.has(month)) map.set(month, { income: 0, expense: 0 });
      const bucket = map.get(month)!;
      if (item.type === "수입") bucket.income += item.amount;
      else bucket.expense += Math.abs(item.amount);
    }
    return Array.from(map.entries())
      .map(([month, v]) => ({ month, income: v.income, expense: v.expense, net: v.income - v.expense }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [savedHistory]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold sm:text-2xl">저장된 내역 관리</h1>
          <Link href="/" className="text-sm text-blue-600 underline underline-offset-2">
            메인으로 돌아가기
          </Link>
        </div>

        {message ? <p className="mb-3 text-sm text-slate-600">{message}</p> : null}
        <p className="mb-4 text-sm text-slate-600">총 저장 건수: {savedHistory.length}건</p>

        <div className="space-y-2">
          {savedHistory.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              저장된 내역이 없습니다.
            </div>
          ) : (
            savedHistory.map((item, index) => (
              <div key={`${item.savedAt}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <input type="date" value={item.date} onChange={(e) => handleEdit(index, "date", e.target.value)} className="rounded border border-slate-300 px-2 py-2" />
                  <input type="date" value={item.occurredDate} onChange={(e) => handleEdit(index, "occurredDate", e.target.value)} className="rounded border border-slate-300 px-2 py-2" />
                  <input type="number" value={item.amount} onChange={(e) => handleEdit(index, "amount", e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-right" />
                  <select value={item.type} onChange={(e) => handleEdit(index, "type", e.target.value)} className="rounded border border-slate-300 px-2 py-2">
                    <option value="지출">지출</option>
                    <option value="수입">수입</option>
                  </select>
                </div>
                <input value={item.description} onChange={(e) => handleEdit(index, "description", e.target.value)} className="mt-2 w-full rounded border border-slate-300 px-2 py-2 text-sm" />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select value={item.category} onChange={(e) => handleEdit(index, "category", e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
                    <option value="">선택</option>
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input value={item.note} onChange={(e) => handleEdit(index, "note", e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm" />
                </div>
                <button type="button" onClick={() => handleDelete(index)} className="mt-2 w-full rounded border border-rose-300 px-2 py-2 text-xs text-rose-700 hover:bg-rose-50">
                  이 항목 삭제
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-slate-800">발생일 기준 월별 손익</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-2 py-2 text-left">월</th>
                  <th className="px-2 py-2 text-right">수입</th>
                  <th className="px-2 py-2 text-right">지출</th>
                  <th className="px-2 py-2 text-right">순수익</th>
                </tr>
              </thead>
              <tbody>
                {monthlySummary.map((row) => (
                  <tr key={row.month} className="border-t border-slate-200">
                    <td className="px-2 py-2">{row.month}</td>
                    <td className="px-2 py-2 text-right">{row.income.toLocaleString()}원</td>
                    <td className="px-2 py-2 text-right">{row.expense.toLocaleString()}원</td>
                    <td className="px-2 py-2 text-right font-semibold">{row.net.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

