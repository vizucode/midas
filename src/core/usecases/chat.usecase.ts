import { ToolMessage } from "@langchain/core/messages";
import type { FinancialAgent } from "../services/agent.service";
import { logger } from "../../utils/logger";

export async function chatUsecase(
    agent: FinancialAgent,
    userId: string | number,
    message: string,
) {
    let result: Awaited<ReturnType<FinancialAgent["invoke"]>>;

    try {
        result = await agent.invoke(
            {
                messages: [
                    {
                        role: "system",
                        content: `Current date: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}. Time zone: Asia/Jakarta. Reply in the user's language. Resolve relative date expressions in any language into exact ISO-8601 date ranges before calling tools. For financial reports, "last N months" always means the N full calendar months before the current month; do not ask for confirmation. "past N months" means a rolling range ending today. Ask for dates only when no standard interpretation applies.`,
                    },
                    { role: "user", content: message },
                ],
            },
            {
                configurable: { thread_id: userId.toString() },
                recursionLimit: 12,
            },
        );
    } catch (error) {
        logger.error("agent invocation failed", {
            userId,
            error: error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack, cause: error.cause }
                : error,
        });
        throw error;
    }

    logger.debug("agent response", { userId, result });

    const failedTools = result.messages
        .filter(ToolMessage.isInstance)
        .filter((toolMessage) => toolMessage.status === "error");

    for (const toolMessage of failedTools) {
        logger.error("mcp tool failed", {
            userId,
            toolName: toolMessage.name,
            toolCallId: toolMessage.tool_call_id,
            status: toolMessage.status,
            error: toolMessage.content,
            artifact: toolMessage.artifact,
            metadata: toolMessage.metadata,
        });
    }

    if (failedTools.length > 0) {
        return "Wallet tidak dapat menyelesaikan permintaan karena error validasi. Coba ulangi dengan detail yang lebih spesifik.";
    }

    const lastMessage = result.messages.at(-1);
    const content = lastMessage?.content;

    if (typeof content === "string") return content;

    return (content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}
