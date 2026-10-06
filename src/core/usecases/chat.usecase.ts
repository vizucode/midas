import { Command } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages";
import type { FinancialAgent } from "../services/agent.service";
import { classifyFinanceScope } from "../services/finance.guardrail";
import { logger } from "../../utils/logger";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Agent execution timeout after ${timeoutMs / 1000} seconds`)),
            timeoutMs,
        );
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer!);
    }
}

export type ChatResult = {
    text: string;
    approval?: {
        threadId: string;
        interruptId: string;
        description: string;
    };
};

export async function resumeChat(
    agent: FinancialAgent,
    userId: string | number,
    interruptId: string,
    decision: "approve" | "reject",
): Promise<ChatResult> {
    const threadId = userId.toString();

    try {
        const result = await withTimeout(
            agent.invoke(
                new Command({ resume: { decisions: [{ type: decision }] } }),
                { configurable: { thread_id: threadId }, recursionLimit: 30 },
            ),
            120_000,
        );

        return extractChatResult(result, threadId, interruptId);
    } catch (error) {
        logger.error("approval resume failed", {
            userId,
            decision,
            error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
        });
        return { text: "Transaksi belum berubah karena server keuangan gagal memproses permintaan. Coba lagi nanti." };
    }
}

export function formatApproval(request: { name?: string; args?: unknown; description?: string }): string {
    if (request.name === "delete_documents" && request.args && typeof request.args === "object") {
        const ids = (request.args as { ids?: unknown }).ids;
        if (Array.isArray(ids) && ids.length > 0) {
            return [
                `Konfirmasi penghapusan permanen ${ids.length} transaksi:`,
                "Data yang dipilih akan dihapus dan tidak bisa dipulihkan.",
                "Lanjut hapus?",
            ].join("\n");
        }
    }

    if (request.name !== "create_records" || !request.args || typeof request.args !== "object") {
        return "Konfirmasi diperlukan untuk melanjutkan perubahan keuangan. Lanjutkan?";
    }

    const records = (request.args as { records?: unknown }).records;
    if (!Array.isArray(records) || records.length === 0) {
        return "Konfirmasi diperlukan untuk mencatat transaksi. Lanjutkan?";
    }

    const expenses = records.filter((record): record is { amount: number; note?: string; recordDate?: string; accountName?: string } =>
        !!record && typeof record === "object" && typeof (record as { amount?: unknown }).amount === "number",
    );
    if (expenses.length !== records.length) {
        return "Konfirmasi diperlukan untuk mencatat transaksi. Lanjutkan?";
    }

    const first = expenses[0];
    if (!first) return "Konfirmasi diperlukan untuk mencatat transaksi. Lanjutkan?";

    const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
    const total = expenses.reduce((sum, record) => sum + Math.abs(record.amount), 0);
    const date = first.recordDate;
    const account = first.accountName;
    const lines = expenses.map((record) => `• ${record.note?.trim() || "Transaksi"} — ${currency.format(Math.abs(record.amount))}`);

    return [
        "Konfirmasi pencatatan pengeluaran:",
        ...lines,
        account ? `Akun: ${account}` : undefined,
        date ? `Tanggal: ${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00+07:00`))}` : undefined,
        `Total: ${currency.format(total)}`,
        "Lanjut catat?",
    ].filter((line): line is string => !!line).join("\n");
}

function extractChatResult(
    result: Awaited<ReturnType<FinancialAgent["invoke"]>>,
    threadId: string,
    fallbackInterruptId?: string,
): ChatResult {
    const interrupt = result.__interrupt__?.[0];
    if (interrupt) {
        const value = interrupt.value as { actionRequests?: Array<{ name?: string; args?: unknown; description?: string }> };
        const request = value.actionRequests?.[0];
        return {
            text: request ? formatApproval(request) : "Konfirmasi diperlukan sebelum transaksi diproses.",
            approval: {
                threadId,
                interruptId: interrupt.id ?? fallbackInterruptId ?? "approval",
                description: request?.description ?? "",
            },
        };
    }

    const lastMessage = result.messages.at(-1);
    const content = lastMessage?.content;
    return {
        text: typeof content === "string"
            ? content
            : (content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\\n"),
    };
}

export async function chatUsecase(
    agent: FinancialAgent,
    userId: string | number,
    message: string,
): Promise<ChatResult> {
    const scope = classifyFinanceScope(message);
    logger.debug("finance scope classified", { userId, scope });

    if (scope === "bot_help") {
        return { text: "Saya asisten keuangan pribadi. Saya bisa bantu cek rekening, catat transaksi, buat anggaran, dan rangkum pengeluaran." };
    }

    if (scope === "out_of_scope") {
        return { text: "Saya fokus bantu urusan keuangan dan akuntansi, seperti transaksi, rekening, anggaran, dan laporan pengeluaran." };
    }

    let result: Awaited<ReturnType<FinancialAgent["invoke"]>>;

    try {
        result = await withTimeout(
            agent.invoke(
                {
                    messages: [
                        {
                            role: "system",
                            content: `Current date: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("/").reverse().join("-")}. Time zone: Asia/Jakarta. Always reply in Indonesian using a relaxed, natural, friendly-professional tone. Use slang only when it fits naturally; never force slang. Keep tool names, field names, enum values, dates, and numeric arguments unchanged. Always use ISO 8601 dates in tool arguments; never use MM/DD/YYYY. Resolve relative date expressions in any language into exact ISO-8601 date ranges before calling tools. For financial reports, "last N months" always means the N full calendar months before the current month; do not ask for confirmation. "past N months" means a rolling range ending today. Ask for dates only when no standard interpretation applies.`,
                        },
                        { role: "user", content: message },
                    ],
                },
                {
                    configurable: { thread_id: userId.toString() },
                    recursionLimit: 30,
                },
            ),
            120_000,
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
        return { text: "Wallet tidak dapat menyelesaikan permintaan karena error validasi. Coba ulangi dengan detail yang lebih spesifik." };
    }

    return extractChatResult(result, userId.toString());
}
