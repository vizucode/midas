import type { FinancialAgent } from "../core/services/agent.service";
import { chatUsecase, type ChatResult } from "../core/usecases/chat.usecase";
import { logger } from "../utils/logger";

export async function handleMessage(agent: FinancialAgent, userId: string | number, message: string): Promise<ChatResult> {
    logger.info("message received", { userId, message });

    try {
        const response = await chatUsecase(agent, userId, message);
        const plainResponse = response.text
            .replaceAll(/\*\*(.*?)\*\*/g, "$1")
            .replaceAll(/`([^`]+)`/g, "$1")
            .replaceAll(/^\s*-\s+/gm, "• ");
        logger.info("message responded", { userId, response: plainResponse });

        return { ...response, text: plainResponse };
    } catch (error) {
        logger.error("message handling failed", {
            userId,
            error: error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack, cause: error.cause }
                : error,
        });

        if (error instanceof Error && error.message === "MCP tool call limit reached") {
            return { text: "Wallet memerlukan terlalu banyak query untuk permintaan ini. Coba minta laporan dengan rentang atau kategori yang lebih spesifik." };
        }

        return { text: "Wallet tidak dapat memproses permintaan saat ini. Coba lagi nanti." };
    }
}