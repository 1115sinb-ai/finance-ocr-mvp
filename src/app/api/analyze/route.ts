import OpenAI from "openai";
import { NextResponse } from "next/server";

type TransactionType = "수입" | "지출";

type TransactionItem = {
  date: string;
  occurredDate: string;
  description: string;
  amount: number;
  type: TransactionType;
};

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function isValidDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function normalizeDate(value: string): string {
  return value.trim().replace(/[./]/g, "-");
}

function getReferenceYear(filename: string): number {
  const yyyymmdd = filename.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
  if (yyyymmdd) return Number(yyyymmdd[1]);
  return new Date().getFullYear();
}

function coerceYear(date: string, referenceYear: number): string {
  if (!isValidDate(date)) return "";
  const [yearText, month, day] = date.split("-");
  const year = Number(yearText);

  // OCR often hallucinates old years; keep month/day and correct the year.
  if (Math.abs(year - referenceYear) >= 2) {
    return `${referenceYear}-${month}-${day}`;
  }
  return date;
}

function parseFlexibleDate(value: string, referenceYear: number): string {
  const normalized = normalizeDate(value);
  if (isValidDate(normalized)) return coerceYear(normalized, referenceYear);

  const monthDayMatch = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (monthDayMatch) {
    const month = monthDayMatch[1].padStart(2, "0");
    const day = monthDayMatch[2].padStart(2, "0");
    const candidate = `${referenceYear}-${month}-${day}`;
    if (isValidDate(candidate)) return candidate;
  }

  return "";
}

function parseSignedAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;

  // Normalize various unicode signs often returned by OCR.
  const normalized = value
    .trim()
    .replace(/[−﹣－–—]/g, "-")
    .replace(/[＋]/g, "+")
    .replace(/[^\d.+-]/g, "");

  if (!normalized) return NaN;
  return Number(normalized);
}

function normalizeType(value: string): TransactionType | null {
  if (value === "수입") return "수입";
  if (value === "지출") return "지출";
  return null;
}

function inferTypeFromAmount(amount: number): TransactionType | null {
  if (amount > 0) return "수입";
  if (amount < 0) return "지출";
  return null;
}

function parseJsonArray(raw: string): unknown[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractArrayText(raw: string): string | null {
  const match = raw.match(/\[[\s\S]*\]/);
  return match?.[0] ?? null;
}

function sanitizeTransactions(raw: unknown[], referenceYear: number): TransactionItem[] {
  const result: TransactionItem[] = [];

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;

    const rawDate = typeof record.date === "string" ? record.date.trim() : "";
    const rawOccurredDate =
      typeof record.occurredDate === "string"
        ? record.occurredDate.trim()
        : typeof record.eventDate === "string"
          ? record.eventDate.trim()
          : rawDate;
    const normalizedDate = parseFlexibleDate(rawDate, referenceYear);
    const normalizedOccurredDate = parseFlexibleDate(rawOccurredDate, referenceYear);
    const date = normalizedDate || normalizedOccurredDate;
    const occurredDate = normalizedOccurredDate || normalizedDate;
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const amount = parseSignedAmount(record.amount);
    const rawType =
      typeof record.type === "string" ? normalizeType(record.type.trim()) : null;

    // Keep rows even when date is partially unreadable.
    // Missing dates are backfilled to reduce dropped rows.
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const finalDate = date || fallbackDate;
    const finalOccurredDate = occurredDate || finalDate;
    if (!description) continue;
    if (!Number.isFinite(amount)) continue;
    const inferredType = inferTypeFromAmount(amount);
    const type = inferredType ?? rawType;
    if (!type) continue;

    result.push({
      date: finalDate,
      occurredDate: finalOccurredDate,
      description,
      amount: Math.trunc(amount),
      type,
    });
  }

  return result;
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const formData = await req.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "이미지 파일이 전달되지 않았습니다." },
        { status: 400 },
      );
    }

    if (!SUPPORTED_TYPES.has(image.type)) {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다. PNG/JPG만 가능합니다." },
        { status: 400 },
      );
    }

    if (image.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "파일 용량이 너무 큽니다. 10MB 이하로 업로드해주세요." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const base64Image = buffer.toString("base64");
    const dataUrl = `data:${image.type};base64,${base64Image}`;

    const client = new OpenAI({ apiKey });
    const referenceYear = getReferenceYear(image.name);

    const prompt = `
당신은 금융 결제 내역 OCR 도우미입니다.
이미지를 읽어 거래 내역을 추출하고, 반드시 JSON 배열만 반환하세요.

요구 형식:
[
  {
    "date": "YYYY-MM-DD",
    "occurredDate": "YYYY-MM-DD",
    "description": "결제처 또는 내용",
    "amount": 12345,
    "type": "수입" | "지출"
  }
]

규칙:
1) 텍스트 외 설명 금지, 코드블록 금지, JSON 배열만 출력
2) date(정산/기록일)와 occurredDate(실제 발생일)를 모두 반환
3) 둘 중 하나만 보이면 보이는 날짜를 두 필드에 동일하게 넣고, 보이지 않는 날짜를 추정하지 마세요
4) 날짜가 일부만 보이면(예: 4.8) YYYY-MM-DD로 보정해서 채우세요
5) 금액은 숫자(Number)만 사용하고 통화기호/콤마 제거
6) 환불/입금/송금받음은 "수입", 결제/송금/출금은 "지출"로 분류
7) 화면에 보이는 거래 행을 누락 없이 최대한 모두 추출하세요 (예: 9건 보이면 9건)
8) 금액의 +/- 부호를 반드시 보존하세요. 특수 마이너스(−)도 일반 -로 반환하세요.
`;

    const completion = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl, detail: "auto" },
          ],
        },
      ],
      max_output_tokens: 2000,
    });

    const outputText = completion.output_text?.trim();
    if (!outputText) {
      return NextResponse.json(
        { error: "AI 응답이 비어 있습니다. 다른 이미지로 다시 시도해주세요." },
        { status: 422 },
      );
    }

    const direct = parseJsonArray(outputText);
    const fallback = direct ?? parseJsonArray(extractArrayText(outputText) ?? "");

    if (!fallback) {
      return NextResponse.json(
        {
          error:
            "AI 응답을 JSON으로 해석하지 못했습니다. 이미지 화질 또는 텍스트 가독성을 확인해주세요.",
        },
        { status: 422 },
      );
    }

    const data = sanitizeTransactions(fallback, referenceYear);
    if (data.length === 0) {
      return NextResponse.json(
        {
          error:
            "유효한 거래 내역을 추출하지 못했습니다. 더 선명한 스크린샷으로 다시 시도해주세요.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json(
      {
        error:
          "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 다른 이미지를 사용해주세요.",
      },
      { status: 500 },
    );
  }
}
