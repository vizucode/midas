import { logger } from "../utils/logger";

export async function handleMessage(userId: string | number, message: string) {
    logger.info("message received", { userId, message });

    return `Echo: ${message}`;
}
