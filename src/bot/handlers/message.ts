import type { Bot } from "grammy";
import type { BaseMessage } from "@langchain/core/messages";
import type { Env } from "../../config/env";
import { getConversationState, saveConversationState, saveIntent } from "../../lib/db";
import { classifyScope, getAgentTools, getTransactionReferenceContext, invokeAgent } from "../../lib/langchain";

const CONFIRM_PATTERN = /\b(konfirmasi|ya,?\s*(catat|simpan)|lanjutkan|setuju)\b/i;
const NEEDS_CONFIRMATION_MARKER = "[BUTUH_KONFIRMASI]";
const GREETING_PATTERN = /^(halo|hai|helo|hello|hi|pagi|siang|sore|malam|terima kasih|makasih)[!.,?\s]*$/i;
const FINANCE_PATTERN = /\b(saldo|uang|keuangan|finansial|rekening|akun|bank|wallet|transaksi|pengeluaran|belanja|pemasukan|pendapatan|budget|anggaran|tabungan|menabung|utang|hutang|transfer|kategori|label|cashflow|rata-rata|ratarata|biaya|tagihan|investasi|catat|simpan)\b/i;

function isFinanceRelated(prompt: string): boolean {
  return GREETING_PATTERN.test(prompt.trim()) || FINANCE_PATTERN.test(prompt);
}

function todayWib(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function textContent(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .map((part) => typeof part === "string" ? part : "text" in part && typeof part.text === "string" ? part.text : "")
    .join("\n")
    .trim();
}

async function askAgent(env: Env, prompt: string, chatId: string, includeReference: boolean): Promise<string> {
  const state = await getConversationState(env, chatId);
  const awaitingConfirmation = state?.lastIntent === "await_confirmation" && !!state.lastParams;
  const userConfirmed = CONFIRM_PATTERN.test(prompt);

  const runConfirmed = awaitingConfirmation && userConfirmed;
  const effectivePrompt = runConfirmed ? state!.lastParams! : prompt;

  const context = !runConfirmed && state?.lastTool
    ? `Konteks percakapan terakhir: tool=${state.lastTool}, params=${state.lastParams || "-"}. Pakai hanya untuk memahami follow-up, bukan sumber data.`
    : "";

  let reference = "";
  if (includeReference || runConfirmed) {
    try {
      reference = await getTransactionReferenceContext(env);
    } catch (error) {
      console.error("[Reference] Gagal memuat akun/kategori:", error instanceof Error ? error.message : error);
    }
  }

  const result = await invokeAgent(
    env,
    `${reference}\n\n${context}\nHari ini ${todayWib()} (WIB).\n\n${effectivePrompt}`.trim(),
    runConfirmed,
  );

  const messages = result.messages as BaseMessage[];
  const final = [...messages].reverse().find((message) => message.getType() === "ai");
  let answer = final ? textContent(final) : "🤔 Maaf, jawaban belum tersedia. Coba jelaskan lebih spesifik.";

  const toolCall = [...messages].reverse().find((message) => message.getType() === "tool");
  const lastTool = toolCall?.name || null;

  if (!runConfirmed && answer.includes(NEEDS_CONFIRMATION_MARKER)) {
    answer = answer.replace(NEEDS_CONFIRMATION_MARKER, "").trim();
    answer += "\n\nBalas *konfirmasi* untuk melanjutkan.";
    await saveConversationState(env, {
      chatId,
      lastIntent: "await_confirmation",
      lastParams: prompt,
      lastTool: null,
      lastToolResult: null,
    });
    return answer;
  }

  await saveConversationState(env, {
    chatId,
    lastIntent: lastTool ? "tool_call" : "chat",
    lastParams: null,
    lastTool,
    lastToolResult: toolCall ? textContent(toolCall) : null,
  });
  if (lastTool) await saveIntent(env, { chatId, intent: lastTool, params: "{}", prompt: effectivePrompt });

  return answer;
}

export function registerMessageHandler(bot: Bot, env: Env): void {
  bot.command("status", async (ctx) => {
    try {
      const tools = await getAgentTools(env);
      await ctx.reply(`✅ BudgetBakers MCP terhubung (${tools.length} tools)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await ctx.reply(`❌ BudgetBakers MCP terputus: ${message}`);
    }
  });

  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    let answer: string;
    try {
      const prompt = ctx.message.text;
      const scope = isFinanceRelated(prompt)
        ? "finance"
        : await classifyScope(env, prompt);

      answer = scope === "out_of_scope"
        ? "Saya hanya membantu keuangan pribadi: saldo, transaksi, pengeluaran, pemasukan, budget, dan analisis keuangan."
        : await askAgent(env, prompt, String(ctx.chat.id), scope === "finance");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "error tidak dikenal";
      answer = detail.includes("Recursion limit")
        ? "🧩 Pertanyaan ini butuh terlalu banyak langkah data. Coba persempit, misalnya sebut akun atau rentang tanggal spesifik."
        : `❌ Gagal memproses: ${detail}`;
    }

    try {
      await ctx.reply(answer, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(answer);
    }
  });
}
