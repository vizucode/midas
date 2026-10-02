import type { FinancialAgent } from "../core/services/agent.service";
import { chatUsecase } from "../core/usecases/chat.usecase";
import { logger } from "../utils/logger";

export async function handleMessage(agent: FinancialAgent, userId: string | number, message: string) {
    logger.info("message received", { userId, message });

    return chatUsecase(agent, message);
}