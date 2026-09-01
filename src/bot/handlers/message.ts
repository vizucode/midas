import type { Bot } from "grammy";
import { env } from "../../config/env";
import { getConversationState, saveConversationState, saveIntent } from "../../lib/db";
import { callMcpTool, getOpenAiTools, listMcpTools } from "../../lib/mcp";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type Intent = {
  intent: "daily_transaction_summary" | "spending_summary" | "income_summary" | "balance_check" | "budget_check" | "create_transaction" | "general" | "unknown";
  params: Record<string, unknown>;
  clarification?: string;
};

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

const MCP_INTENT_PATTERN = /\b(wallet|rekening|account|balance|saldo|budget|cash|tabungan|expense|expenses|income|transaction|transactions|mutasi|bank|kartu|card|dompet|finance|finansial|keuangan|pengeluaran|pemasukan|utang|piutang|kategori|belanja|bayar|dibayar|habis|uang)\b/i;

function shouldUseMcp(prompt: string): boolean {
  return MCP_INTENT_PATTERN.test(prompt);
}

function hasPeriodQuery(prompt: string): boolean {
  return /\b\d+\s+(hari|minggu|bulan|tahun)\s+terakhir\b|\b(hari|minggu|bulan|tahun)\s+ini\b|\b(last|past)\s+\d+\s+(days|weeks|months|years)\b/i.test(prompt);
}

function isRecentTransactionQuery(prompt: string): boolean {
  return !hasPeriodQuery(prompt) && /\b(transaksi|transaction|mutasi|record)\b.*\b(terakhir|terbaru|latest|recent)\b|\b(terakhir|terbaru|latest|recent)\b.*\b(transaksi|transaction|mutasi|record)\b|\b(transaksi|transaction|mutasi|record)\b.*\b(hari ini|today)\b/i.test(prompt);
}

function isThreeMonthSummaryQuery(prompt: string): boolean {
  return /\b(3|tiga)\s+bulan\s+terakhir\b|\blast\s+3\s+months\b|\bbulan\s+terakhir\b/i.test(prompt);
}

function startOfMonth(date: Date): string {
  const value = new Date(date);
  value.setUTCDate(1);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString().slice(0, 10);
}

function monthsAgoRange(months: number): [string, string] {
  const end = new Date();
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - months);
  return [`gte.${startOfMonth(start)}`, `lt.${end.toISOString().slice(0, 10)}`];
}

function currentMonthRange(): [string, string] {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return [`gte.${start.toISOString().slice(0, 10)}`, `lt.${new Date().toISOString().slice(0, 10)}`];
}

function transactionQueryRange(prompt: string): [string, string] {
  if (/\bhari ini\b|\btoday\b/i.test(prompt)) {
    return todayRange();
  }

  if (isThreeMonthSummaryQuery(prompt)) {
    return monthsAgoRange(3);
  }

  return currentMonthRange();
}

function todayRange(): [string, string] {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return [`gte.${today}`, `lt.${tomorrow}`];
}

type RecordResult = {
  records?: Array<{
    amount?: { currencyCode?: string; value?: number };
    accountName?: string;
    category?: { name?: string };
    note?: string;
    counterParty?: string;
    recordDate?: string;
    recordType?: string;
  }>;
};

function formatDailyTransactions(result: string): string {
  const data = JSON.parse(result) as RecordResult;
  const records = data.records || [];
  if (!records.length) return "📭 *Belum ada pengeluaran hari ini di Wallet.*";
  let total = 0;
  const lines = records.map((record, index) => {
    const amount = Math.abs(record.amount?.value || 0);
    total += amount;
    const currency = record.amount?.currencyCode || "IDR";
    const description = record.note || record.counterParty || "Tanpa keterangan";
    const category = record.category?.name || "Tanpa kategori";
    return `${index + 1}. ${description} — ${currency} ${new Intl.NumberFormat("id-ID").format(amount)} (${category})`;
  });
  return `📊 *Pengeluaran hari ini (WIB)*\n\n${lines.join("\n")}\n\n💸 *Total: IDR ${new Intl.NumberFormat("id-ID").format(total)}*`;
}

function formatLatestTransaction(result: string): string {
  const data = JSON.parse(result) as RecordResult;
  const record = data.records?.[0];

  if (!record) {
    return "📭 *Belum ada transaksi hari ini.*";
  }

  const amount = record.amount?.value ?? 0;
  const currency = record.amount?.currencyCode || "IDR";
  const formattedAmount = new Intl.NumberFormat("id-ID").format(Math.abs(amount));
  const type = amount < 0 || record.recordType === "expense" ? "Pengeluaran" : "Pemasukan";
  const icon = type === "Pengeluaran" ? "💸" : "💰";
  const description = record.note || record.counterParty || "Tanpa keterangan";
  const date = record.recordDate ? new Date(record.recordDate).toLocaleString("id-ID") : "-";

  return [
    "📌 *TRANSAKSI TERAKHIR HARI INI*",
    "",
    `${icon} *${type}:* ${currency} ${formattedAmount}`,
    `📝 *Keterangan:* ${description}`,
    `🏷️ *Kategori:* ${record.category?.name || "Tanpa kategori"}`,
    `🏦 *Akun:* ${record.accountName || "-"}`,
    `🕒 *Waktu:* ${date}`,
  ].join("\n");
}

async function requestNineRouter(
  messages: ChatMessage[],
  tools?: ReturnType<typeof getOpenAiTools>,
  forcedToolName?: string,
): Promise<ChatResponse> {
  const response = await fetch(`${env.NINE_ROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.NINE_ROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.NINE_ROUTER_MODEL,
      messages,
      tools,
      tool_choice: forcedToolName
        ? { type: "function", function: { name: forcedToolName } }
        : tools?.length
          ? "auto"
          : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`9router error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as ChatResponse;
}

async function classifyIntent(prompt: string, previousIntent?: string | null, previousParams?: string | null): Promise<Intent> {
  const todayWib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const response = await requestNineRouter([{
    role: "system",
    content: `Klasifikasikan pesan menjadi satu intent: daily_transaction_summary, spending_summary, income_summary, balance_check, budget_check, create_transaction, general, unknown. Balas JSON valid saja dengan bentuk {"intent":"...","params":{},"clarification":"..."}. Isi params dari pesan: date, dateRange, recordType, category, account, amount, description, timezone. Hari ini dalam WIB adalah ${todayWib}; frasa "hari ini" tidak ambigu dan harus memakai tanggal tersebut tanpa bertanya timezone. Pesan berupa zona waktu seperti WIB/WITA/WIT/UTC adalah follow-up terhadap intent sebelumnya. Gunakan konteks intent sebelumnya dan gabungkan params sebelumnya untuk follow-up. Jika permintaan ambigu dan konteks tidak cukup, pilih unknown dan isi clarification. Intent sebelumnya: ${previousIntent || "-"}. Params sebelumnya: ${previousParams || "-"}.`,
  }, { role: "user", content: prompt }]);
  const content = response.choices?.[0]?.message?.content?.trim() || "";
  try {
    return JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")) as Intent;
  } catch {
    return { intent: "unknown", params: {}, clarification: "Maksud permintaan Anda belum dapat dipahami. Bisa dijelaskan lebih spesifik?" };
  }
}

function nextDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function todayWibRange(): [string, string] {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const today = `${value("year")}-${value("month")}-${value("day")}`;
  return [`gte.${today}`, `lt.${nextDate(today)}`];
}

function readToolForIntent(intent: Intent): { name: string; args: Record<string, unknown> } | null {
  const date = typeof intent.params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(intent.params.date)
    ? intent.params.date
    : undefined;
  const recordDate = date ? [`gte.${date}`, `lt.${nextDate(date)}`] : todayWibRange();

  if (intent.intent === "daily_transaction_summary" || intent.intent === "spending_summary" || intent.intent === "income_summary") {
    return { name: "get_records", args: { recordType: intent.intent === "income_summary" ? "income" : "expense", recordDate, sortBy: ["-recordDate"], limit: 100 } };
  }
  if (intent.intent === "balance_check") return { name: "get_accounts", args: {} };
  if (intent.intent === "budget_check") return { name: "get_budgets", args: {} };
  return null;
}

async function askNineRouter(prompt: string, chatId: string): Promise<string> {
  const state = await getConversationState(chatId);
  const classifiedIntent = await classifyIntent(prompt, state?.lastIntent, state?.lastParams);
  const intent = /\b(pengeluaran|transaksi|belanja)\b.*\b(hari ini|today)\b/i.test(prompt)
    ? { ...classifiedIntent, intent: "daily_transaction_summary" as const }
    : classifiedIntent;
  const params = JSON.stringify(intent.params);
  await saveIntent({ chatId, intent: intent.intent, params, prompt });

  if (intent.intent === "unknown") {
    return intent.clarification || "Maksud permintaan Anda belum jelas. Bisa dijelaskan lebih spesifik?";
  }

  if (intent.intent === "create_transaction" && !/\b(konfirmasi|ya,?\s*(catat|simpan)|lanjutkan)\b/i.test(prompt)) {
    await saveConversationState({ chatId, lastIntent: intent.intent, lastParams: params });
    return `Konfirmasi pencatatan transaksi berikut: ${params}\n\nBalas *konfirmasi* untuk menyimpan.`;
  }
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `Jawab dalam Bahasa Indonesia dengan format Telegram yang rapi. Intent terklasifikasi: ${intent.intent}. Params: ${params}. Untuk data keuangan Wallet, wajib gunakan MCP tools dan jangan mengarang atau memakai riwayat chat sebagai sumber data. Untuk create_transaction, hanya panggil create_records bila user sudah mengonfirmasi. Pakai emoji seperlunya, bullet singkat, bold untuk judul/angka penting.`,
    },
    ...(state
      ? [{
          role: "system" as const,
          content: `Konteks percakapan terakhir: intent=${state.lastIntent || "-"}, params=${state.lastParams || "-"}, tool=${state.lastTool || "-"}. Gunakan hanya sebagai konteks follow-up, bukan sumber data keuangan.`,
        }]
      : []),
    { role: "user", content: prompt },
  ];

  const routedTool = readToolForIntent(intent);
  if (routedTool) {
    let result: string;
    try {
      result = await callMcpTool(routedTool.name, routedTool.args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP tool failed";
      await saveConversationState({
        chatId,
        lastIntent: intent.intent,
        lastParams: params,
        lastTool: routedTool.name,
        lastToolResult: JSON.stringify({ error: message }),
      });
      return `MCP gagal membaca data: ${message}`;
    }
    await saveConversationState({
      chatId,
      lastIntent: intent.intent,
      lastParams: params,
      lastTool: routedTool.name,
      lastToolResult: result,
    });
    if (intent.intent === "daily_transaction_summary") {
      return formatDailyTransactions(result);
    }
    messages.push({
      role: "system",
      content: `Hasil MCP dari ${routedTool.name}:\n${result}\n\nJawab pertanyaan user dari hasil ini. Jangan mengarang atau meminta data yang sudah tersedia.`,
    });
    const final = await requestNineRouter(messages);
    return final.choices?.[0]?.message?.content?.trim() || "MCP tidak mengembalikan jawaban.";
  }

  const response = await requestNineRouter(messages);
  return response.choices?.[0]?.message?.content?.trim() || "Data MCP tidak tersedia.";
}

export function registerMessageHandler(bot: Bot): void {
  bot.command("status", async (ctx) => {
    try {
      const tools = await listMcpTools(true);
      await ctx.reply(`BudgetBakers MCP connected (${tools.length} tools)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await ctx.reply(`BudgetBakers MCP disconnected: ${message}`);
    }
  });

  bot.on("message:text", async (ctx) => {
    const name = ctx.from.first_name || ctx.from.username || "teman";
    const answer = await askNineRouter(ctx.message.text, String(ctx.chat.id));

    try {
      await ctx.reply(answer || `hello ${name}`, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(answer || `hello ${name}`);
    }
  });
}
