import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Env } from "../config/env";

export const WRITE_TOOL_PATTERN = /^(create|update|delete|remove|edit|set|add)_/i;

const BASE_PROMPT = `Kamu asisten keuangan pribadi di Telegram. Jawab dalam Bahasa Indonesia, rapi, pakai bold untuk angka penting dan bullet singkat. Pakai emoji yang relevan: 💸 pengeluaran, 💰 pemasukan/saldo, 📊 ringkasan, 📭 data kosong, ✅ sukses, ⚠️ peringatan. Semua data keuangan wajib diambil lewat tools yang tersedia; dilarang mengarang angka atau memakai riwayat chat sebagai sumber data.

ATURAN TOOL: Panggil tool hanya bila butuh data. Setelah data cukup, langsung beri jawaban final dan jangan panggil tool lagi. Jangan panggil tool yang sama lagi dengan parameter sama atau mirip setelah berhasil. Jika tool error, coba paling banyak sekali lagi dengan parameter berbeda; bila gagal lagi, jelaskan keterbatasannya kepada user. Maksimal empat putaran tool per percakapan.

**PENTING — Rekomendasi Keuangan:**
Untuk setiap jawaban yang berkaitan dengan data keuangan (saldo, pengeluaran, pemasukan, kategori spending, budget, rata-rata harian, dll), WAJIB tambahkan 1 baris rekomendasi singkat yang relevan dengan angka/fakta yang baru saja ditampilkan. Contoh: jika pengeluaran kategori tertentu tinggi, sarankan evaluasi; jika saldo menipis mendekati akhir bulan, ingatkan persiapan; jika pola pengeluaran wajar, beri apresiasi singkat. Rekomendasi harus spesifik berdasarkan data yang ditunjukkan, BUKAN template generik. Tuliskan di baris baru dengan format: 💡 *Saran:* [isi rekomendasi]. Jangan tambahkan saran untuk jawaban non-finansial (sapaan umum, error, instruksi, permintaan konfirmasi).`;

const READ_ONLY_SUFFIX = `\n\nTool untuk menulis/mengubah/menghapus data (catat transaksi, dsb) TIDAK tersedia buatmu sekarang. Jika user memintanya: jangan mencoba memanggil tool apapun untuk itu, cukup jelaskan singkat rencana aksinya (tool apa, data apa), lalu WAJIB akhiri pesanmu persis dengan baris baru berisi "[BUTUH_KONFIRMASI]" tanpa teks lain setelahnya.`;

const CONFIRMED_SUFFIX = `\n\nUser sudah mengonfirmasi aksi ini sebelumnya. Lanjutkan eksekusi tool yang relevan sekarang.`;

let mcpClient: MultiServerMCPClient | null = null;
let cachedTools: DynamicStructuredTool[] | null = null;
let readOnlyAgent: Awaited<ReturnType<typeof createReactAgent>> | null = null;
let fullAgent: Awaited<ReturnType<typeof createReactAgent>> | null = null;

function sanitizeInput(input: unknown): unknown {
  if (input === null || input === undefined) return {};
  if (Array.isArray(input)) return input.map(sanitizeInput).filter((value) => value !== undefined);
  if (typeof input !== "object") return input;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = sanitizeInput(value) as Record<string, unknown>;
      if (Object.keys(nested).length > 0) sanitized[key] = nested;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

async function initMcpClient(env: Env): Promise<MultiServerMCPClient> {
  if (mcpClient) return mcpClient;

  mcpClient = new MultiServerMCPClient({
    budgetbakers: {
      type: "http",
      url: env.MCP_SERVER_URL,
      headers: {
        [env.MCP_SERVER_AUTH_HEADER === "Bearer" ? "Authorization" : "X-Auth"]: `${env.MCP_SERVER_AUTH_HEADER} ${env.MCP_SERVER_AUTH_TOKEN}`,
      },
    },
  });

  return mcpClient;
}

async function getWrappedTools(env: Env): Promise<DynamicStructuredTool[]> {
  if (cachedTools) return cachedTools;

  const client = await initMcpClient(env);
  const mcpTools = await client.getTools();

  cachedTools = mcpTools.map((tool) => {
    const originalFunc = tool.func;
    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description || tool.name,
      schema: tool.schema,
      func: async (input: unknown, config?: unknown) => {
        const rawInput = JSON.stringify(input);
        const sanitized = sanitizeInput(input);
        const sanitizedInput = JSON.stringify(sanitized);
        console.log(`[LangChain Tool] Calling ${tool.name}:`, sanitizedInput);
        if (rawInput !== sanitizedInput) {
          console.log(`[LangChain Tool] Sanitized ${tool.name} (dropped empty fields):`, rawInput);
        }

        const cache = (config as { configurable?: { callCache?: Map<string, string> } } | undefined)?.configurable?.callCache;
        const cacheKey = `${tool.name}:${sanitizedInput}`;

        if (cache?.has(cacheKey)) {
          console.log(`[LangChain Tool] Duplicate call blocked ${tool.name}`);
          return `Panggilan ini sudah dilakukan sebelumnya dengan parameter sama. Hasil sebelumnya:\n${cache.get(cacheKey)}\n\nJANGAN panggil tool lagi. Susun jawaban final sekarang dari data yang sudah ada.`;
        }

        try {
          const result = await originalFunc(sanitized, config as never);
          const text = typeof result === "string" ? result : JSON.stringify(result);
          console.log(`[LangChain Tool] Result ${tool.name}:`, text.slice(0, 200));
          cache?.set(cacheKey, text.slice(0, 4000));
          return result;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`[LangChain Tool] Error ${tool.name}:`, detail);
          const message = `Error saat memanggil ${tool.name}: ${detail}. Jangan ulangi parameter yang sama; ubah parameter atau jelaskan keterbatasan ini ke user.`;
          cache?.set(cacheKey, message);
          return message;
        }
      },
    });
  });

  return cachedTools;
}

function buildLlm(env: Env): ChatOpenAI {
  return new ChatOpenAI({
    model: env.NINE_ROUTER_MODEL,
    apiKey: env.NINE_ROUTER_API_KEY,
    configuration: { baseURL: env.NINE_ROUTER_BASE_URL },
  });
}

async function getReadOnlyAgent(env: Env) {
  if (readOnlyAgent) return readOnlyAgent;

  const tools = await getWrappedTools(env);
  const safeTools = tools.filter((tool) => !WRITE_TOOL_PATTERN.test(tool.name));

  readOnlyAgent = await createReactAgent({
    llm: buildLlm(env),
    tools: safeTools,
    prompt: BASE_PROMPT + READ_ONLY_SUFFIX,
  });

  return readOnlyAgent;
}

async function getFullAgent(env: Env) {
  if (fullAgent) return fullAgent;

  const tools = await getWrappedTools(env);

  fullAgent = await createReactAgent({
    llm: buildLlm(env),
    tools,
    prompt: BASE_PROMPT + CONFIRMED_SUFFIX,
  });

  return fullAgent;
}

export async function invokeAgent(env: Env, prompt: string, confirmed: boolean = false) {
  const agent = confirmed ? await getFullAgent(env) : await getReadOnlyAgent(env);
  const callCache = new Map<string, string>();
  return agent.invoke(
    { messages: [{ role: "user", content: prompt }] },
    { recursionLimit: env.AGENT_RECURSION_LIMIT, configurable: { callCache } },
  );
}

export async function getAgentTools(env: Env) {
  return getWrappedTools(env);
}

export async function closeAgent() {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    cachedTools = null;
    readOnlyAgent = null;
    fullAgent = null;
  }
}
