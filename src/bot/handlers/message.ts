import type { Bot } from "grammy";
import { env } from "../../config/env";
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

const MCP_INTENT_PATTERN = /\b(wallet|rekening|account|balance|saldo|budget|cash|tabungan|expense|expenses|income|transaction|transactions|mutasi|bank|kartu|card|dompet|finance|finansial|keuangan)\b/i;

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

async function askNineRouter(prompt: string): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Jawab dalam format Telegram yang rapi dan eye-catching. Pakai emoji seperlunya, bullet singkat, bold untuk judul/angka penting, dan hindari penjelasan panjang.",
    },
    { role: "user", content: prompt },
  ];

  if (!shouldUseMcp(prompt)) {
    const data = await requestNineRouter(messages);
    return data.choices?.[0]?.message?.content?.trim() || "";
  }

  const mcpTools = await listMcpTools();
  const tool = isRecentTransactionQuery(prompt)
    ? mcpTools.find((item) => item.name === "get_records")
    : mcpTools.find((item) => item.name === "get_records_aggregation") ||
      mcpTools.find((item) => item.name === "get_records") ||
      mcpTools[0];

  if (!tool) {
    const data = await requestNineRouter(messages);
    return data.choices?.[0]?.message?.content?.trim() || "";
  }

  const args = isRecentTransactionQuery(prompt)
    ? {
        recordDate: transactionQueryRange(prompt),
        sortBy: ["-recordDate"],
        limit: 1,
      }
    : isThreeMonthSummaryQuery(prompt)
      ? {
          groupBy: ["month", "category:name"],
          compute: ["baseAmount:absSum"],
          recordType: "expense",
          recordDate: monthsAgoRange(3),
          limit: 1000,
        }
      : tool.name === "get_records_aggregation"
        ? {
            groupBy: ["month", "category:name"],
            compute: ["baseAmount:absSum"],
            recordType: "expense",
            recordDate: monthsAgoRange(3),
            limit: 1000,
          }
        : tool.name === "get_records"
          ? {
              recordType: "expense",
              recordDate: monthsAgoRange(3),
              limit: 1000,
            }
          : {};

  const result = await callMcpTool(tool.name, args);

  if (isRecentTransactionQuery(prompt)) {
    return formatLatestTransaction(result);
  }

  const analysisMessages: ChatMessage[] = [
    {
      role: "user",
      content:
        `Analisa kondisi keuangan dari data MCP berikut untuk pertanyaan: ${prompt}\n\n` +
        `Format wajib cocok untuk Telegram: judul tebal, emoji relevan, bullet ringkas, angka penting ditebalkan, mudah dibaca di chat.\n` +
        (isRecentTransactionQuery(prompt)
          ? "Fokus pada transaksi terbaru saja. Jika kosong, jawab belum ada transaksi hari ini.\n"
          : "Fokus pada pengeluaran per kategori 3 bulan terakhir, breakdown bulanan, kategori terbesar, dan insight singkat.\n") +
        `\n${result}`,
    },
  ];

  const final = await requestNineRouter(analysisMessages);
  return final.choices?.[0]?.message?.content?.trim() || result || "";
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
    const answer = await askNineRouter(ctx.message.text);

    await ctx.reply(answer || `hello ${name}`, { parse_mode: "Markdown" });
  });
}
