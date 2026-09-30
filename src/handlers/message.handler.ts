import type { FinancialAgent } from "../core/services/agent.service";
import { logger } from "../utils/logger";

export async function handleMessage(agent: FinancialAgent, userId: string | number, message: string) {
    logger.info("message received", { userId, message });

    const result = await agent.invoke([
        { role: "user", content: message },
    ]);

    if (typeof result.content === "string") return result.content;

    return result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}