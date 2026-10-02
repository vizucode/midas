import type { FinancialAgent } from "../services/agent.service";

export async function chatUsecase(
    agent: FinancialAgent,
    message: string,
) {
    const result = await agent.invoke({
        messages: [{ role: "user", content: message }],
    });

    const lastMessage = result.messages.at(-1);
    const content = lastMessage?.content;

    if (typeof content === "string") return content;

    return (content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}
