import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, createMiddleware, humanInTheLoopMiddleware } from "langchain";
import { getMcpTools } from "./mcp.service";
import { logger } from "../../utils/logger";

const writeTools = [
    "create_records",
    "create_account",
    "create_budget",
    "create_category",
    "create_label",
    "patch_records",
    "patch_accounts",
    "patch_budgets",
    "patch_categories",
    "patch_labels",
    "delete_documents",
] as const;

export function createFinancialAgent(
    model: Parameters<typeof createAgent>[0]["model"],
    tools: Awaited<ReturnType<typeof getMcpTools>>,
) {
    return createAgent({
        model,
        systemPrompt: "You are a financial assistant. Never send empty-string values in optional enum filters. Omit source or recordState when the user did not specify a valid value. Never report zero or no data when a tool returns an error; explain the tool error instead.",
        tools,
        checkpointer: new MemorySaver(),
        middleware: [
            createMiddleware({
                name: "mcpInputGuard",
                wrapToolCall: async (request, handler) => {
                    const args = request.toolCall.args;
                    if (args && typeof args === "object") {
                        for (const key of ["source", "recordState"]) {
                            const value = (args as Record<string, unknown>)[key];
                            const isEmpty = value == null
                                || value === ""
                                || (Array.isArray(value) && value.every(
                                    (item) => typeof item !== "string" || item.trim() === "",
                                ));

                            if (isEmpty) delete (args as Record<string, unknown>)[key];
                        }
                    }

                    logger.debug("mcp tool call", {
                        toolName: request.toolCall.name,
                        toolCallId: request.toolCall.id,
                        args,
                    });

                    return handler(request);
                },
            }),
            humanInTheLoopMiddleware({
                interruptOn: Object.fromEntries(writeTools.map((name) => [name, true])),
            }),
        ],
    });
}

export async function initAgent() {
    const tools = await getMcpTools();
    const model = new ChatOpenAI({
        model: process.env.NINE_ROUTER_MODEL!,
        apiKey: process.env.NINE_ROUTER_API_KEY,
        configuration: {
            baseURL: process.env.NINE_ROUTER_BASE_URL,
        },
    });

    return createFinancialAgent(model, tools);
}

export type FinancialAgent = Awaited<ReturnType<typeof initAgent>>;
