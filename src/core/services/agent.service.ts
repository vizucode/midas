import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
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
        systemPrompt: "You are a financial assistant. Never include optional fields when their value is empty, null, unknown, or invalid. Only send optional enum fields with an allowed value. For a request listing transactions and finding the largest category, make exactly two calls: get_records without categoryGroup, then get_records_aggregation once with category:name grouping and baseAmount:absSum. For spending-by-category reports, call get_records_aggregation once with the requested date range, category:name grouping, and baseAmount:absSum; omit categoryGroup unless user explicitly requests one group. Do not call get_client_profile unless user asks about their profile, permissions, sync, or settings. After receiving sufficient tool data, stop calling tools and answer the user. For every response, write naturally and warmly in the user's language: lead with a useful financial insight, then concise details. Use plain text suitable for Telegram; do not use Markdown syntax, raw API data, or technical jargon. For account lists, mention total balance, highlight largest or notable balances, group zero-balance accounts separately, and end with one useful follow-up question. For errors, explain clearly what could not be completed and suggest a practical next step. For confirmations, state the action, amount, account, and date plainly. Never report zero or no data when a tool returns an error.",
        tools,
        checkpointer: new MemorySaver(),
        middleware: [
            createMiddleware({
                name: "mcpInputGuard",
                wrapToolCall: async (request, handler) => {
                    const args = Object.fromEntries(
                        Object.entries(request.toolCall.args ?? {}).filter(([, value]) => {
                            if (value == null) return false;
                            if (typeof value === "string" && value.trim() === "") return false;
                            if (Array.isArray(value) && value.length > 0) {
                                return !value.every(
                                    (item) => typeof item === "string" && item.trim() === "",
                                );
                            }
                            return true;
                        }),
                    );
                    const messages = request.state.messages as Array<AIMessage | HumanMessage>;
                    const lastHumanMessage = messages.findLastIndex(HumanMessage.isInstance);
                    const priorMessages = messages.slice(lastHumanMessage);
                    const priorToolCalls = priorMessages
                        .filter(AIMessage.isInstance)
                        .flatMap((message: AIMessage) => message.tool_calls ?? []);
                    const hasCategoryAggregation = priorToolCalls.some(
                        (call: { name: string; args: Record<string, unknown> }) =>
                            call.name === "get_records_aggregation"
                            && Array.isArray(call.args.groupBy)
                            && call.args.groupBy.includes("category:name"),
                    );

                    if (
                        (request.toolCall.name === "get_records_aggregation"
                            && Array.isArray(args.groupBy)
                            && args.groupBy.includes("category:name"))
                        || (request.toolCall.name === "get_records" && hasCategoryAggregation)
                    ) {
                        delete args.categoryGroup;
                    }

                    const aggregationCallCount = priorToolCalls.filter(
                        (call: { name: string }) => call.name === "get_records_aggregation",
                    ).length;
                    if (
                        request.toolCall.name === "get_records_aggregation"
                        && Array.isArray(args.groupBy)
                        && args.groupBy.includes("category:name")
                        && aggregationCallCount > 1
                    ) {
                        logger.warn("duplicate category aggregation blocked", { args });
                        return new ToolMessage({
                            content: "Category aggregation already returned data. Use its result and answer the user without another tool call.",
                            tool_call_id: request.toolCall.id ?? request.toolCall.name ?? "mcp-tool",
                            name: request.toolCall.name,
                            status: "success",
                        });
                    }

                    const callKey = `${request.toolCall.name}:${JSON.stringify(args)}`;
                    const matchingCallCount = priorToolCalls.filter(
                        (call: { name: string; args: unknown }) =>
                            `${call.name}:${JSON.stringify(call.args)}` === callKey,
                    ).length;
                    if (matchingCallCount > 1) {
                        logger.warn("duplicate mcp tool call blocked", {
                            toolName: request.toolCall.name,
                            args,
                        });
                        throw new Error(`Duplicate MCP tool call blocked: ${request.toolCall.name}`);
                    }

                    const toolCallCount = priorMessages
                        .filter(AIMessage.isInstance)
                        .reduce(
                            (count: number, message: AIMessage) => count + (message.tool_calls?.length ?? 0),
                            0,
                        );
                    if (toolCallCount >= 4) {
                        logger.warn("mcp tool call limit reached", {
                            toolName: request.toolCall.name,
                            toolCallCount,
                        });
                        return new ToolMessage({
                            content: "Tool call limit reached. Use data from previous tool results and answer the user now.",
                            tool_call_id: request.toolCall.id ?? request.toolCall.name ?? "mcp-tool",
                            name: request.toolCall.name,
                            status: "success",
                        });
                    }

                    const sanitizedRequest = {
                        ...request,
                        toolCall: { ...request.toolCall, args },
                    };

                    logger.debug("mcp tool call", {
                        toolName: request.toolCall.name,
                        toolCallId: request.toolCall.id,
                        args,
                    });

                    const result = await handler(sanitizedRequest);
                    const artifact = ToolMessage.isInstance(result) ? result.artifact : undefined;
                    const content = ToolMessage.isInstance(result)
                        && Array.isArray(result.content)
                        && result.content.length === 0
                        && artifact !== undefined
                        ? JSON.stringify(artifact)
                        : result;

                    logger.debug("mcp tool response", {
                        toolName: request.toolCall.name,
                        toolCallId: request.toolCall.id,
                        result,
                    });

                    if (typeof content === "string" && ToolMessage.isInstance(result)) {
                        return new ToolMessage({
                            content,
                            tool_call_id: result.tool_call_id,
                            name: request.toolCall.name,
                            status: result.status,
                            artifact: result.artifact,
                            metadata: result.metadata,
                        });
                    }

                    return result;
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
