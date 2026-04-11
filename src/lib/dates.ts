/**
 * YYYY-MM-DD만 허용. ISO 날짜시간·슬래시·점 표기를 흡수하고,
 * 파싱 불가·달력에 없는 날짜는 "" — 모바일 <input type="date"> 오동작 방지.
 */
export function normalizeDateInput(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  let head = raw.includes("T") ? (raw.split("T")[0] ?? "").trim() : raw;
  head = head.replace(/[./]/g, "-");
  const match = head.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return "";
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return "";
  }
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function ledgerDateSortKey(item: { date: string; occurredDate: string }): string {
  const o = normalizeDateInput(item.occurredDate);
  if (o) return o;
  const d = normalizeDateInput(item.date);
  if (d) return d;
  return "9999-12-31";
}

/** 발생일(없으면 날짜) 오름차순 — 같은 날이면 저장 시각 순 */
export function sortSavedLedgerOrder<
  T extends { date: string; occurredDate: string; savedAt: string; description: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const c = ledgerDateSortKey(a).localeCompare(ledgerDateSortKey(b));
    if (c !== 0) return c;
    const t = a.savedAt.localeCompare(b.savedAt);
    if (t !== 0) return t;
    return (a.description ?? "").localeCompare(b.description ?? "");
  });
}
