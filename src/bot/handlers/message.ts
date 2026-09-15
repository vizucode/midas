import type { Bot } from "grammy";
import type { Env } from "../../config/env";
import { getConversationState, saveConversationState, saveIntent } from "../../lib/db";
import { callMcpTool, getOpenAiTools, listMcpTools } from "../../lib/mcp";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

const MAX_TOOL_STEPS = 5;
const WRITE_TOOL_PATTERN = /^(create|update|delete|remove|edit|set|add)_/i;
const CONFIRM_PATTERN = /\b(konfirmasi|ya,?\s*(catat|simpan)|lanjutkan|setuju)\b/i;

async function requestNineRouter(
  env: Env,
  messages: ChatMessage[],
  tools?: ReturnType<typeof getOpenAiTools>,
): Promise<ChatResponse> {
  const payload = {
    model: env.NINE_ROUTER_MODEL,
    messages,
    tools,
    tool_choice: tools?.length ? "auto" : undefined,
    stream: false,
  };

  console.log(`[9router] Request:`, JSON.stringify(payload, null, 2));

  const response = await fetch(`${env.NINE_ROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.NINE_ROUTER_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  console.log(`[9router] Response (status ${response.status}):`, raw);

  if (!response.ok) {
    throw new Error(`9router error: ${response.status} ${response.statusText} - ${raw.slice(0, 500)}`);
  }

  try {
    return JSON.parse(raw) as ChatResponse;
  } catch {
    throw new Error(`9router non-JSON response: ${raw.slice(0, 500)}`);
  }
}

function todayWib(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function askNineRouter(env: Env, prompt: string, chatId: string): Promise<string> {
  const state = await getConversationState(env, chatId);
  const tools = await listMcpTools(env);
  const confirmed = CONFIRM_PATTERN.test(prompt);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `Kamu asisten keuangan pribadi di Telegram. Jawab dalam Bahasa Indonesia, rapi, pakai bold untuk angka penting dan bullet singkat. Hari ini ${todayWib()} (WIB). Semua data keuangan wajib diambil lewat tools yang tersedia; dilarang mengarang angka atau memakai riwayat chat sebagai sumber data. Panggil tool sebanyak yang dibutuhkan sebelum menjawab.`,
    },
    ...(state?.lastIntent || state?.lastTool
      ? [{
          role: "system" as const,
          content: `Konteks percakapan terakhir: tool=${state.lastTool || "-"}, params=${state.lastParams || "-"}. Pakai hanya untuk memahami follow-up, bukan sumber data.`,
        }]
      : []),
    { role: "user", content: prompt },
  ];

  let lastTool: string | null = null;
  let lastResult: string | null = null;

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const response = await requestNineRouter(env, messages, getOpenAiTools(tools));
    const message = response.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];

    if (!message || calls.length === 0) {
      const answer = message?.content?.trim() || "Maaf, jawaban belum tersedia. Coba jelaskan lebih spesifik.";
      await saveConversationState(env, {
        chatId,
        lastIntent: lastTool ? "tool_call" : "chat",
        lastParams: null,
        lastTool,
        lastToolResult: lastResult,
      });
      return answer;
    }

    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: calls as ToolCall[],
    });

    for (const call of calls) {
      const name = call.function?.name || "";
      const known = tools.some((tool) => tool.name === name);

      if (!known) {
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: tool ${name} tidak tersedia.` });
        continue;
      }

      if (WRITE_TOOL_PATTERN.test(name) && !confirmed) {
        await saveConversationState(env, {
          chatId,
          lastIntent: "await_confirmation",
          lastParams: call.function?.arguments || null,
          lastTool: name,
          lastToolResult: null,
        });
        return `Konfirmasi dulu ya. Aksi: *${name}*\nData: ${call.function?.arguments || "{}"}\n\nBalas *konfirmasi* untuk melanjutkan.`;
      }

      let args: unknown;
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: argumen bukan JSON valid.` });
        continue;
      }

      try {
        const result = await callMcpTool(env, name, args);
        lastTool = name;
        lastResult = result;
        await saveIntent(env, { chatId, intent: name, params: JSON.stringify(args), prompt });
        messages.push({ role: "tool", tool_call_id: call.id, content: result || "(kosong)" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "MCP tool gagal";
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${detail}` });
      }
    }
  }

  return "Permintaan terlalu kompleks (batas langkah tool tercapai). Coba persempit pertanyaannya.";
}

export function registerMessageHandler(bot: Bot, env: Env): void {
  bot.command("status", async (ctx) => {
    try {
      const tools = await listMcpTools(env, true);
      await ctx.reply(`BudgetBakers MCP connected (${tools.length} tools)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await ctx.reply(`BudgetBakers MCP disconnected: ${message}`);
    }
  });

  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    let answer: string;
    try {
      answer = await askNineRouter(env, ctx.message.text, String(ctx.chat.id));
    } catch (error) {
      answer = `Gagal memproses: ${error instanceof Error ? error.message : "error tidak dikenal"}`;
    }

    try {
      await ctx.reply(answer, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(answer);
    }
  });
}
