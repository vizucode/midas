import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, createMiddleware, humanInTheLoopMiddleware } from "langchain";
import { getMcpTools } from "./mcp.service";
import { logger } from "../../utils/logger";

const MAX_TOOL_CALLS = 30;
const checkpointers = new WeakMap<object, MemorySaver>();

export async function clearAgentThread(agent: FinancialAgent, userId: string | number) {
    await checkpointers.get(agent)?.deleteThread(userId.toString());
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

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
    const checkpointer = new MemorySaver();
    const agent = createAgent({
        model,
        systemPrompt: `You are a financial assistant.
        - Never include optional fields when their value is empty, null, unknown, or invalid.
        - Only send optional enum fields with an allowed value.
        - For all-transactions requests, omit both categoryId and categoryGroup. Never invent a category filter or query every category separately.
        - For a specific category, call get_categories to resolve its actual name and ID, including custom categories. Use the matching categoryId according to the tool input schema; never invent an ID. If no category matches or multiple categories match, ask the user to clarify before querying transactions.
        - Do not use categoryGroup with get_records. Its response already includes each transaction's category. Never split an all-transactions request into separate calls per category.
        - For a request listing transactions and finding the largest category, use one get_records call and one get_records_aggregation call with category:name grouping and baseAmount:absSum. Preserve any explicitly requested categoryId resolved from get_categories.
        - For spending across all categories, use get_records_aggregation with the requested date range, category:name grouping, and baseAmount:absSum without categoryId or categoryGroup.
        - Do not call get_client_profile unless user asks about their profile, permissions, sync, or settings.
        - After receiving sufficient tool data, stop calling tools and answer the user.
        - For every response, write naturally and warmly in the user's language: lead with a useful financial insight, then concise details. Use plain text suitable for Telegram; do not use Markdown syntax, raw API data, or technical jargon.
        - For account lists, mention total balance, highlight largest or notable balances, group zero-balance accounts separately, and end with one useful follow-up question.
        - For errors, explain clearly what could not be completed and suggest a practical next step. For confirmations, state the action, amount, account, and date plainly.
        - Never report zero or no data when a tool returns an error.
        - Always respond in Indonesian. Use a relaxed, natural, friendly-professional tone; use slang only when it fits naturally, never force it. Keep tool names, field names, enum values, dates, and numeric arguments exactly as required by the MCP schema. Never translate or alter tool arguments.`,
        tools,
        checkpointer,
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
                    if (
                        request.toolCall.name === "get_records_aggregation"
                        && Array.isArray(args.groupBy)
                        && args.groupBy.includes("category:name")
                    ) {
                        delete args.categoryId;
                        delete args.categoryGroup;
                    }

                    if (request.toolCall.name === "get_records") {
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

                    const callKey = `${request.toolCall.name}:${stableStringify(args)}`;
                    const matchingCallCount = priorToolCalls.filter(
                        (call: { name: string; args: unknown }) =>
                            `${call.name}:${stableStringify(call.args)}` === callKey,
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
                    if (toolCallCount >= MAX_TOOL_CALLS) {
                        logger.error("mcp execution budget exhausted", {
                            toolName: request.toolCall.name,
                            toolCallCount,
                            maxToolCalls: MAX_TOOL_CALLS,
                        });
                        throw new Error(`MCP execution budget exhausted after ${MAX_TOOL_CALLS} tool calls`);
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
    checkpointers.set(agent, checkpointer);
    return agent;
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
