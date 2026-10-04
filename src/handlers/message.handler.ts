import type { FinancialAgent } from "../core/services/agent.service";
import { chatUsecase } from "../core/usecases/chat.usecase";
import { logger } from "../utils/logger";

export async function handleMessage(agent: FinancialAgent, userId: string | number, message: string) {
    logger.info("message received", { userId, message });

    try {
        const response = await chatUsecase(agent, userId, message);
        logger.info("message responded", { userId, response });

        return response;
    } catch (error) {
        logger.error("message handling failed", {
            userId,
            error: error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack, cause: error.cause }
                : error,
        });

        return "Wallet tidak dapat memproses permintaan saat ini. Coba lagi nanti.";
    }
}