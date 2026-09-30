import { ChatOpenAI } from "@langchain/openai";
import { getMcpTools } from "./mcp.service";

export async function initAgent() {
    const tools = await getMcpTools();

    return new ChatOpenAI({
        model: process.env.NINE_ROUTER_MODEL!,
        configuration: {
            baseURL: process.env.NINE_ROUTER_BASE_URL,
            apiKey: process.env.NINE_ROUTER_API_KEY
        }
    }).bindTools(tools);
}

export type FinancialAgent = Awaited<ReturnType<typeof initAgent>>;
