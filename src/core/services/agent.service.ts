import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { getMcpTools } from "./mcp.service";

export async function initAgent() {
    const tools = await getMcpTools();

    const model = new ChatOpenAI({
        model: process.env.NINE_ROUTER_MODEL!,
        apiKey: process.env.NINE_ROUTER_API_KEY,
        configuration: {
            baseURL: process.env.NINE_ROUTER_BASE_URL,
        },
    });

    return createAgent({
        model,
        systemPrompt: "You are a financial assistant.",
        tools,
    });
}

export type FinancialAgent = Awaited<ReturnType<typeof initAgent>>;
