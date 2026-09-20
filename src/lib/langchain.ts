import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Env } from "../config/env";

export const WRITE_TOOL_PATTERN = /^(create|update|delete|remove|edit|set|add)_/i;

const BASE_PROMPT = `Kamu asisten keuangan pribadi di Telegram. Jawab dalam Bahasa Indonesia, rapi, pakai bold untuk angka penting dan bullet singkat. Pakai emoji yang relevan: 💸 pengeluaran, 💰 pemasukan/saldo, 📊 ringkasan, 📭 data kosong, ✅ sukses, ⚠️ peringatan. Semua data keuangan wajib diambil lewat tools yang tersedia; dilarang mengarang angka atau memakai riwayat chat sebagai sumber data. Panggil tool sebanyak yang dibutuhkan sebelum menjawab, lalu berhenti begitu jawaban sudah cukup.

**PENTING — Rekomendasi Keuangan:**
Untuk setiap jawaban yang berkaitan dengan data keuangan (saldo, pengeluaran, pemasukan, kategori spending, budget, rata-rata harian, dll), WAJIB tambahkan 1 baris rekomendasi singkat yang relevan dengan angka/fakta yang baru saja ditampilkan. Contoh: jika pengeluaran kategori tertentu tinggi, sarankan evaluasi; jika saldo menipis mendekati akhir bulan, ingatkan persiapan; jika pola pengeluaran wajar, beri apresiasi singkat. Rekomendasi harus spesifik berdasarkan data yang ditunjukkan, BUKAN template generik. Tuliskan di baris baru dengan format: 💡 *Saran:* [isi rekomendasi]. Jangan tambahkan saran untuk jawaban non-finansial (sapaan umum, error, instruksi, permintaan konfirmasi).`;

const READ_ONLY_SUFFIX = `\n\nTool untuk menulis/mengubah/menghapus data (catat transaksi, dsb) TIDAK tersedia buatmu sekarang. Jika user memintanya: jangan mencoba memanggil tool apapun untuk itu, cukup jelaskan singkat rencana aksinya (tool apa, data apa), lalu WAJIB akhiri pesanmu persis dengan baris baru berisi "[BUTUH_KONFIRMASI]" tanpa teks lain setelahnya.`;

const CONFIRMED_SUFFIX = `\n\nUser sudah mengonfirmasi aksi ini sebelumnya. Lanjutkan eksekusi tool yang relevan sekarang.`;

let mcpClient: MultiServerMCPClient | null = null;
let cachedTools: DynamicStructuredTool[] | null = null;
let readOnlyAgent: Awaited<ReturnType<typeof createReactAgent>> | null = null;
let fullAgent: Awaited<ReturnType<typeof createReactAgent>> | null = null;

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
        console.log(`[LangChain Tool] Calling ${tool.name}:`, JSON.stringify(input));
        try {
          const result = await originalFunc(input, config as never);
          console.log(`[LangChain Tool] Result ${tool.name}:`, typeof result === "string" ? result.slice(0, 200) : result);
          return result;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.error(`[LangChain Tool] Error ${tool.name}:`, detail);
          return `Error saat memanggil ${tool.name}: ${detail}`;
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
  return agent.invoke(
    { messages: [{ role: "user", content: prompt }] },
    { recursionLimit: env.AGENT_RECURSION_LIMIT },
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
