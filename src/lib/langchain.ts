import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Env } from "../config/env";

const WRITE_TOOL_PATTERN = /^(create|update|delete|remove|edit|set|add)_/i;
const CONFIRM_PATTERN = /\b(konfirmasi|ya,?\s*(catat|simpan)|lanjutkan|setuju)\b/i;

let mcpClient: MultiServerMCPClient | null = null;
let agentExecutor: Awaited<ReturnType<typeof createReactAgent>> | null = null;

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

async function initAgent(env: Env) {
  if (agentExecutor) return agentExecutor;

  const client = await initMcpClient(env);
  const mcpTools = await client.getTools();

  const wrappedTools = mcpTools.map((tool) => {
    const originalFunc = tool.func;
    return new DynamicStructuredTool({
      name: tool.name,
      description: tool.description || tool.name,
      schema: tool.schema,
      func: async (input: unknown, config?: any) => {
        const inputStr = JSON.stringify(input);
        console.log(`[LangChain Tool] Calling ${tool.name}:`, inputStr);

        if (WRITE_TOOL_PATTERN.test(tool.name)) {
          const confirmed = config?.metadata?.confirmed || false;
          if (!confirmed) {
            return `⚠️ Konfirmasi dulu ya.\n\n*Aksi:* ${tool.name}\n*Data:* ${inputStr}\n\nBalas *konfirmasi* untuk melanjutkan.`;
          }
        }

        const result = await originalFunc(input, config);
        console.log(`[LangChain Tool] Result ${tool.name}:`, typeof result === "string" ? result.slice(0, 200) : result);
        return result;
      },
    });
  });

  const llm = new ChatOpenAI({
    model: env.NINE_ROUTER_MODEL,
    apiKey: env.NINE_ROUTER_API_KEY,
    configuration: { baseURL: env.NINE_ROUTER_BASE_URL },
  });

  agentExecutor = await createReactAgent({
    llm,
    tools: wrappedTools,
    prompt: `Kamu asisten keuangan pribadi di Telegram. Jawab dalam Bahasa Indonesia, rapi, pakai bold untuk angka penting dan bullet singkat. Pakai emoji yang relevan: 💸 pengeluaran, 💰 pemasukan/saldo, 📊 ringkasan, 📭 data kosong, ✅ sukses, ⚠️ peringatan. Semua data keuangan wajib diambil lewat tools yang tersedia; dilarang mengarang angka atau memakai riwayat chat sebagai sumber data. Panggil tool sebanyak yang dibutuhkan sebelum menjawab.`,
  });

  return agentExecutor;
}

export async function invokeAgent(env: Env, prompt: string, confirmed: boolean = false) {
  const agent = await initAgent(env);
  const result = await agent.invoke(
    { messages: [{ role: "user", content: prompt }] },
    { metadata: { confirmed }, recursionLimit: 5 },
  );
  return result;
}

export async function getAgentTools(env: Env) {
  const client = await initMcpClient(env);
  const tools = await client.getTools();
  return tools;
}

export async function closeAgent() {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    agentExecutor = null;
  }
}
