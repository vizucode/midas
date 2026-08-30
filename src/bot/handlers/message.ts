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
  const tool =
    mcpTools.find((item) => item.name === "get_records_aggregation") ||
    mcpTools.find((item) => item.name === "get_records") ||
    mcpTools[0];

  if (!tool) {
    const data = await requestNineRouter(messages);
    return data.choices?.[0]?.message?.content?.trim() || "";
  }

  const args =
    tool.name === "get_records_aggregation"
      ? {
          groupBy: ["month", "category:name"],
          compute: ["baseAmount:absSum"],
          recordType: "expense",
          recordDate: ["gte.2026-05-31", "lt.2026-08-31"],
          limit: 1000,
        }
      : tool.name === "get_records"
        ? {
            recordType: "expense",
            recordDate: ["gte.2026-05-31", "lt.2026-08-31"],
            limit: 1000,
          }
        : {};

  const result = await callMcpTool(tool.name, args);
  const analysisMessages: ChatMessage[] = [
    {
      role: "user",
      content:
        `Analisa kondisi keuangan dari data MCP berikut untuk pertanyaan: ${prompt}\n\n` +
        `Format wajib cocok untuk Telegram: judul tebal, emoji relevan, bullet ringkas, angka penting ditebalkan, mudah dibaca di chat.\n` +
        `Fokus pada pengeluaran per kategori 3 bulan terakhir, breakdown bulanan, kategori terbesar, dan insight singkat.\n\n` +
        result,
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
