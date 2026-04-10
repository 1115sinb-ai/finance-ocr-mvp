"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 10;
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

type TransactionType = "수입" | "지출";

type TransactionItem = {
  date: string;
  occurredDate: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  note: string;
};

type SavedTransactionItem = TransactionItem & {
  savedAt: string;
};

const LOCAL_STORAGE_KEY = "finance-ocr-confirmed-transactions";
const DRAFT_STORAGE_KEY = "finance-ocr-analysis-draft";

function normalizeDateInput(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/[./]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeTransactionItem(item: Partial<TransactionItem>): TransactionItem {
  return {
    date: normalizeDateInput(item.date ?? ""),
    occurredDate: normalizeDateInput(item.occurredDate ?? item.date ?? ""),
    description: item.description ?? "",
    amount: Number(item.amount ?? 0),
    type: item.type === "수입" ? "수입" : "지출",
    category: item.category ?? "",
    note: item.note ?? "",
  };
}

function dedupeByDateAmount(items: SavedTransactionItem[]): SavedTransactionItem[] {
  const seen = new Set<string>();
  const result: SavedTransactionItem[] = [];

  for (const item of items) {
    const key = `${item.date}__${item.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<TransactionItem[]>([]);
  const [confirmedResult, setConfirmedResult] = useState<TransactionItem[] | null>(
    null,
  );
  const [savedHistory, setSavedHistory] = useState<SavedTransactionItem[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedTransactionItem[];
      if (!Array.isArray(parsed)) return;
      const normalized = parsed.map((item) => ({
          ...normalizeTransactionItem(item),
          savedAt: item.savedAt ?? new Date().toISOString(),
        }));
      const deduped = dedupeByDateAmount(normalized);
      setSavedHistory(deduped);
      if (deduped.length !== normalized.length) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(deduped));
        setSaveMessage(
          `기존 저장 내역에서 중복 ${normalized.length - deduped.length}건을 정리했습니다.`,
        );
      }
    } catch {
      setSaveMessage("저장 내역을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!rawDraft) return;
      const parsed = JSON.parse(rawDraft) as Partial<TransactionItem>[];
      if (!Array.isArray(parsed)) return;
      setAnalysisResult(parsed.map((item) => normalizeTransactionItem(item)));
      if (parsed.length > 0) {
        setSaveMessage("이전 작업 내역(임시저장)을 불러왔습니다.");
      }
    } catch {
      // Ignore malformed draft data.
    }
  }, []);

  useEffect(() => {
    try {
      if (analysisResult.length === 0) {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        return;
      }
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(analysisResult));
    } catch {
      // Ignore storage quota errors.
    }
  }, [analysisResult]);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    setUploadError(null);

    if (rejectedFiles.length > 0) {
      const firstErrorCode = rejectedFiles[0]?.errors?.[0]?.code;
      if (firstErrorCode === "file-too-large") {
        setUploadError("파일 용량이 너무 큽니다. 10MB 이하 이미지를 업로드해주세요.");
      } else if (firstErrorCode === "file-invalid-type") {
        setUploadError("지원하지 않는 형식입니다. PNG/JPG 이미지만 업로드해주세요.");
      } else {
        setUploadError("이미지 업로드에 실패했습니다. 파일을 다시 확인해주세요.");
      }
      return;
    }

    if (acceptedFiles.length === 0) {
      setUploadError("업로드된 파일이 없습니다. 다시 시도해주세요.");
      return;
    }

    setSelectedFiles((prev) => [...prev, ...acceptedFiles].slice(0, MAX_FILES));
    setAnalyzeError(null);
    setConfirmedResult(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
    },
    maxFiles: MAX_FILES,
    maxSize: MAX_FILE_SIZE,
  });

  const previewUrls = useMemo(
    () =>
      selectedFiles.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [selectedFiles],
  );

  useEffect(() => {
    return () => {
      previewUrls.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [previewUrls]);

  const statusItems = useMemo(() => {
    if (uploadError) {
      return [uploadError, "이미지 화질이 낮으면 OCR 정확도가 떨어질 수 있습니다."];
    }

    if (analyzeError) {
      return [
        analyzeError,
        "화질이 낮거나 잘린 이미지일 수 있습니다.",
        "필요하면 다른 스크린샷으로 다시 시도해주세요.",
      ];
    }

    if (isAnalyzing) {
      return ["AI가 이미지를 분석 중입니다.", "보통 수 초 내에 결과가 반환됩니다."];
    }

    if (selectedFiles.length === 0) {
      return [
        "이미지를 업로드해주세요.",
        "분석 실패 시 에러 메시지를 보여줍니다.",
        "데이터 없음 상태를 안내합니다.",
      ];
    }

    return [
      `선택된 파일 수: ${selectedFiles.length}개`,
      `총 용량: ${(
        selectedFiles.reduce((sum, file) => sum + file.size, 0) /
        1024 /
        1024
      ).toFixed(2)} MB`,
      analysisResult.length > 0
        ? `총 ${analysisResult.length}건의 내역이 추출되었습니다.`
        : "분석 버튼을 눌러 AI OCR을 실행하세요.",
    ];
  }, [analyzeError, analysisResult.length, isAnalyzing, selectedFiles, uploadError]);

  const handleAnalyze = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setAnalyzeError("분석할 이미지가 없습니다. 먼저 이미지를 업로드해주세요.");
      return;
    }

    try {
      setIsAnalyzing(true);
      setAnalyzeError(null);

      const mergedResults: TransactionItem[] = [];

      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("image", file);

        const response = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
        });

        const payload = (await response.json()) as {
          data?: Partial<TransactionItem>[];
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(
            `${file.name}: ${payload.error ?? "분석에 실패했습니다."}`,
          );
        }

        mergedResults.push(
          ...payload.data.map((item) => normalizeTransactionItem(item)),
        );
      }

      setAnalysisResult(mergedResults);
      setConfirmedResult(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      setAnalyzeError(message);
      setAnalysisResult([]);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedFiles]);

  const handleEditRow = useCallback(
    (rowIndex: number, field: keyof TransactionItem, value: string) => {
      setAnalysisResult((prev) =>
        prev.map((row, index) => {
          if (index !== rowIndex) return row;
          if (field === "amount") {
            const amount = Number(value) || 0;
            const nextType =
              amount > 0 ? "수입" : amount < 0 ? "지출" : row.type;
            return { ...row, amount, type: nextType };
          }
          if (field === "type") {
            return {
              ...row,
              type: value === "수입" ? "수입" : "지출",
            };
          }
          if (field === "date" || field === "occurredDate") {
            return { ...row, [field]: normalizeDateInput(value) };
          }
          return { ...row, [field]: value };
        }),
      );
      setConfirmedResult(null);
    },
    [],
  );

  const totals = useMemo(() => {
    const income = analysisResult
      .filter((row) => row.type === "수입")
      .reduce((sum, row) => sum + row.amount, 0);
    const expense = analysisResult
      .filter((row) => row.type === "지출")
      .reduce((sum, row) => sum + Math.abs(row.amount), 0);
    return { income, expense, net: income - expense };
  }, [analysisResult]);

  const handleConfirm = useCallback(() => {
    if (analysisResult.length === 0) return;

    const savedAt = new Date().toISOString();
    const existingKeys = new Set(savedHistory.map((item) => `${item.date}__${item.amount}`));
    const newUniqueItems = analysisResult
      .filter((item) => !existingKeys.has(`${item.date}__${item.amount}`))
      .map((item) => ({ ...item, savedAt }));
    const nextSaved = [...newUniqueItems, ...savedHistory];

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextSaved));
      setSavedHistory(nextSaved);
      setConfirmedResult(analysisResult);
      if (newUniqueItems.length === 0) {
        setSaveMessage("중복 항목(날짜+금액 동일)만 있어 새로 저장된 내역이 없습니다.");
      } else {
        setSaveMessage(`${newUniqueItems.length}건이 저장되었습니다.`);
      }
    } catch {
      setSaveMessage("저장에 실패했습니다. 브라우저 저장공간을 확인해주세요.");
    }
  }, [analysisResult, savedHistory]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-4 sm:gap-8 sm:px-6 sm:py-8 lg:px-8">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-blue-700">MVP Step 4</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            금융 결제내역 자동 정리
          </h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            결제 스크린샷을 업로드하고 AI로 내역을 추출해 회계 데이터로 정리하는
            앱입니다.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold">1) 이미지 업로드</h2>
            <p className="mt-2 text-sm text-slate-600">
              PNG/JPG 스크린샷을 드래그 앤 드롭하거나 클릭하여 여러 장
              업로드합니다.
            </p>
            <div
              {...getRootProps()}
              className={`mt-4 cursor-pointer rounded-xl border border-dashed p-5 text-center text-sm transition sm:p-8 ${
                isDragActive
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-300 bg-slate-50 text-slate-500 hover:border-blue-400 hover:bg-blue-50/50"
              }`}
            >
              <input {...getInputProps()} />
              {isDragActive
                ? "여기에 이미지를 놓으세요."
                : `이미지를 드래그 앤 드롭하거나 클릭해서 선택하세요. (최대 ${MAX_FILES}장)`}
            </div>

            {previewUrls.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {previewUrls.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                  >
                    <Image
                      src={item.url}
                      alt={`업로드 이미지 미리보기 ${index + 1}`}
                      width={1200}
                      height={900}
                      unoptimized
                      className="h-44 w-full cursor-zoom-in object-cover"
                      onClick={() => setActivePreviewUrl(item.url)}
                    />
                    <div className="flex items-center justify-between gap-2 p-2 text-xs text-slate-600">
                      <span className="truncate">{item.name}</span>
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                        onClick={() =>
                          setSelectedFiles((prev) =>
                            prev.filter((_, fileIndex) => fileIndex !== index),
                          )
                        }
                      >
                        제거
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                아직 업로드된 이미지가 없습니다.
              </div>
            )}

            {selectedFiles.length > 0 ? (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
                <span>{selectedFiles.length}개 파일 선택됨</span>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 hover:bg-white"
                  onClick={() => {
                    setSelectedFiles([]);
                    setUploadError(null);
                    setAnalyzeError(null);
                    setAnalysisResult([]);
                    setConfirmedResult(null);
                  }}
                >
                  선택 해제
                </button>
              </div>
            ) : null}

            {uploadError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {uploadError}
              </div>
            ) : null}
            <div className="mt-3 text-xs text-slate-500">
              권장: 해상도 선명한 캡처 이미지, 파일당 최대 10MB, 최대 10장
            </div>
            <button
              type="button"
              disabled={selectedFiles.length === 0 || isAnalyzing}
              onClick={handleAnalyze}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:py-2"
            >
              {isAnalyzing ? "AI 분석 중..." : "AI 분석 시작"}
            </button>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">상태</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {statusItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>

        <section className="grid gap-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">3) 검토 및 확정</h2>
            <p className="mt-2 text-sm text-slate-600">
              분석 내역을 표로 확인하고 수정/확정합니다. 수입/지출 합계도 함께
              계산됩니다.
            </p>
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left">날짜</th>
                    <th className="px-3 py-2 text-left">발생일</th>
                    <th className="px-3 py-2 text-left">결제처/내용</th>
                    <th className="px-3 py-2 text-right">금액</th>
                    <th className="w-32 px-3 py-2 text-left">구분</th>
                    <th className="px-3 py-2 text-left">종류</th>
                    <th className="px-3 py-2 text-left">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {analysisResult.length > 0 ? (
                    analysisResult.map((row, index) => (
                      <tr
                        key={`${row.date}-${row.occurredDate}-${row.description}-${index}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={row.date}
                            onChange={(e) =>
                              handleEditRow(index, "date", e.target.value)
                            }
                            className="w-full rounded border border-slate-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={row.occurredDate}
                            onChange={(e) =>
                              handleEditRow(index, "occurredDate", e.target.value)
                            }
                            className="w-full rounded border border-slate-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={row.description}
                            onChange={(e) =>
                              handleEditRow(index, "description", e.target.value)
                            }
                            className="w-full rounded border border-slate-300 px-2 py-1"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={row.amount}
                            onChange={(e) =>
                              handleEditRow(index, "amount", e.target.value)
                            }
                            className="w-full rounded border border-slate-300 px-2 py-1 text-right"
                          />
                        </td>
                        <td className="w-32 px-3 py-2">
                          <select
                            value={row.type}
                            onChange={(e) =>
                              handleEditRow(index, "type", e.target.value)
                            }
                            className="w-full min-w-[100px] rounded border border-slate-300 px-2 py-1"
                          >
                            <option value="지출">지출</option>
                            <option value="수입">수입</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={row.category}
                            onChange={(e) =>
                              handleEditRow(index, "category", e.target.value)
                            }
                            className="w-28 rounded border border-slate-300 px-2 py-1"
                          >
                            <option value="">선택</option>
                            {CATEGORY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={row.note}
                            onChange={(e) =>
                              handleEditRow(index, "note", e.target.value)
                            }
                            placeholder="메모 입력"
                            className="w-full rounded border border-slate-300 px-2 py-1"
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                        분석된 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {analysisResult.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                  분석된 데이터가 없습니다.
                </div>
              ) : (
                analysisResult.map((row, index) => (
                  <div
                    key={`${row.date}-${row.occurredDate}-${row.description}-${index}-mobile`}
                    className="rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="text-slate-500">날짜</label>
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => handleEditRow(index, "date", e.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                      <label className="text-slate-500">발생일</label>
                      <input
                        type="date"
                        value={row.occurredDate}
                        onChange={(e) =>
                          handleEditRow(index, "occurredDate", e.target.value)
                        }
                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="mt-2 space-y-2">
                      <input
                        value={row.description}
                        onChange={(e) =>
                          handleEditRow(index, "description", e.target.value)
                        }
                        placeholder="결제처/내용"
                        className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(e) => handleEditRow(index, "amount", e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-2 text-sm text-right"
                        />
                        <select
                          value={row.type}
                          onChange={(e) => handleEditRow(index, "type", e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                        >
                          <option value="지출">지출</option>
                          <option value="수입">수입</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={row.category}
                          onChange={(e) =>
                            handleEditRow(index, "category", e.target.value)
                          }
                          className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                        >
                          <option value="">종류 선택</option>
                          {CATEGORY_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <input
                          value={row.note}
                          onChange={(e) => handleEditRow(index, "note", e.target.value)}
                          placeholder="비고"
                          className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 grid gap-2 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
              <p>수입 합계: {totals.income.toLocaleString()}원</p>
              <p>지출 합계: {totals.expense.toLocaleString()}원</p>
              <p className="font-semibold">
                순액: {totals.net.toLocaleString()}원
              </p>
            </div>

            <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <button
                type="button"
                disabled={analysisResult.length === 0}
                onClick={handleConfirm}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto sm:py-2"
              >
                내역 확정
              </button>
              {confirmedResult ? (
                <span className="text-sm text-emerald-700">
                  {confirmedResult.length}건의 내역이 확정되었습니다.
                </span>
              ) : (
                <span className="text-sm text-slate-500">
                  아직 확정된 데이터가 없습니다.
                </span>
              )}
            </div>
            {saveMessage ? (
              <p className="mt-2 text-sm text-slate-600">{saveMessage}</p>
            ) : null}

            <div className="mt-5 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">저장된 내역</h3>
                <div className="flex items-center gap-3">
                  <Link
                    href="/saved"
                    className="text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800"
                  >
                    저장된 내역 페이지 열기
                  </Link>
                </div>
              </div>
              <div className="mt-2 space-y-1 text-sm text-slate-600">
                <p>총 저장 건수: {savedHistory.length}건</p>
                <p>
                  마지막 저장 시각:{" "}
                  {savedHistory[0]
                    ? new Date(savedHistory[0].savedAt).toLocaleString()
                    : "-"}
                </p>
                <p className="text-xs text-slate-500">
                  상세 수정/삭제/월별 손익은 저장된 내역 페이지에서 확인하세요.
                </p>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">2) AI 분석 결과(JSON)</h2>
            <p className="mt-2 text-sm text-slate-600">
              날짜, 결제처/내용, 금액, 입출금 구분을 추출해서 구조화합니다.
            </p>
            <div className="mt-4 rounded-xl bg-slate-900 p-4 text-xs text-slate-100">
              <pre className="whitespace-pre-wrap break-all">
                {analysisResult.length > 0
                  ? JSON.stringify(analysisResult, null, 2)
                  : `[
  {
    "date": "YYYY-MM-DD",
    "occurredDate": "YYYY-MM-DD",
    "description": "결제처 또는 내용",
    "amount": 0,
    "type": "지출",
    "category": "식비",
    "note": "점심 결제"
  }
]`}
              </pre>
            </div>
            {analyzeError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {analyzeError}
              </div>
            ) : null}
          </article>
        </section>
      </main>

      {activePreviewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setActivePreviewUrl(null)}
        >
          <div
            className="relative w-full max-w-5xl overflow-hidden rounded-xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 z-10 rounded-md bg-black/70 px-2 py-1 text-sm text-white"
              onClick={() => setActivePreviewUrl(null)}
            >
              닫기
            </button>
            <Image
              src={activePreviewUrl}
              alt="스크린샷 확대 미리보기"
              width={2000}
              height={2000}
              unoptimized
              className="h-auto max-h-[85vh] w-full object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
