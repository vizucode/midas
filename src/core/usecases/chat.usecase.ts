import { RequestContext } from "@mastra/core/request-context";
import type { FinancialAgent } from "../services/agent.service";
import { ApprovalStore } from "../services/approval.store";
import { classifyFinanceScope } from "../services/finance.guardrail";

export type ChatResult = { text: string; approval?: { id: string } };
export function formatApproval(request: { name?: string; args?: unknown }): string {
    if (!request.name || !request.args || typeof request.args !== "object" || !Object.keys(request.args).length) throw new Error("Invalid approval preview");
    const text = `Konfirmasi perubahan: ${request.name}\n${JSON.stringify(request.args, null, 2)}\nSetujui hanya jika semua rincian benar.`;
    if (text.length > 3500) throw new Error("Approval preview too large");
    return text;
}
export function scopeReply(message: string): string | undefined {
    if (classifyFinanceScope(message) === "bot_help") return "Saya asisten keuangan pribadi. Saya bisa bantu cek rekening, catat transaksi, buat anggaran, dan rangkum pengeluaran.";
}
export function dateContext() {
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return `Current date: ${date}. Time zone: Asia/Jakarta. Always use ISO 8601 dates in tool arguments; never use MM/DD/YYYY. Resolve relative date expressions into exact ISO-8601 date ranges. For financial reports, last N months means N full calendar months before the current month; do not ask for confirmation. Past N months means a rolling range ending today. Ask for dates only when no standard interpretation applies.`;
}
export type ScopeReplyGenerator = (text: string, owner: string, chat: string, abortSignal: AbortSignal) => Promise<string>;
export class ChatService {
    constructor(readonly agent: FinancialAgent, readonly store: ApprovalStore, readonly contracts: Record<string, string>, readonly generateScopeReply?: ScopeReplyGenerator) { }
    private async outOfScope(text: string, owner: string, chat: string): Promise<ChatResult> {
        if (!this.generateScopeReply) {
            return { text: "Aku belum bisa bantu soal itu. Aku bisa bantu urusan keuangan seperti transaksi, rekening, anggaran, atau pengeluaran." };
        }
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                const reply = await this.generateScopeReply(text, owner, chat, controller.signal);
                return { text: reply.trim() || "Aku fokus bantu urusan keuangan. Ada yang ingin kamu cek?" };
            } finally { clearTimeout(timer); }
        } catch { return { text: "Aku belum bisa bantu soal itu. Aku bisa bantu urusan keuangan seperti transaksi, rekening, anggaran, atau pengeluaran." }; }
    }
    private async execute(owner: string, chat: string, run: string, action: (options: { requestContext: RequestContext; abortSignal: AbortSignal; maxSteps: number }) => Promise<Awaited<ReturnType<FinancialAgent["generate"]>>>, nativeRun = run): Promise<ChatResult> {
        const requestContext = new RequestContext();
        for (const [key, value] of Object.entries({ appRunId: run, ownerId: owner, chatId: chat, nativeRunId: nativeRun })) requestContext.set(key, value);
        const controller = new AbortController();
        const remaining = await this.store.remaining(run);
        const timer = setTimeout(() => controller.abort(), Math.max(1, remaining));
        try {
            if (remaining <= 0) throw new Error("Execution deadline exhausted");
            const result = await Promise.race([action({ requestContext, abortSignal: controller.signal, maxSteps: 30 }), new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Execution deadline exhausted")), { once: true }))]);
            const outcome = await this.store.outcome(run);
            if (result.tripwire || outcome.failed || controller.signal.aborted) throw new Error("Execution blocked or failed");
            if (result.finishReason === "suspended") {
                const p = result.suspendPayload as { toolCallId?: string; toolName?: string; args?: unknown };
                if (!p?.toolCallId || !p.toolName || !result.runId || !this.contracts[p.toolName]) throw new Error("Invalid suspension");
                const text = formatApproval({ name: p.toolName, args: p.args });
                const id = await this.store.pending(run, result.runId, p.toolCallId, p.toolName, p.args, this.contracts[p.toolName]!);
                await this.store.finish(run, "waiting");
                return { text, approval: { id } };
            }
            await this.store.finish(run, "done");
            return { text: result.text || "Maaf, belum ada respons. Coba lagi." };
        } catch {
            controller.abort();
            const outcome = await this.store.outcome(run);
            await this.store.finish(run, "uncertain");
            return { text: outcome.possible_write ? "Hasil perubahan belum dapat dipastikan. Periksa catatan keuangan sebelum mencoba lagi; jangan ulangi perubahan ini secara otomatis." : "Wallet tidak dapat memproses permintaan saat ini. Coba lagi nanti." };
        } finally { clearTimeout(timer); }
    }
    async message(owner: string, chat: string, text: string): Promise<ChatResult> {
        if (scopeReply(text) || classifyFinanceScope(text) === "out_of_scope") return this.outOfScope(text, owner, chat);
        const run = await this.store.start(owner, chat);
        return this.execute(owner, chat, run, options => this.agent.generate([{ role: "system", content: dateContext() }, { role: "user", content: text }], { ...options, runId: run, memory: { resource: owner, thread: chat } }));
    }
    async decide(owner: string, chat: string, id: string, approve: boolean): Promise<ChatResult> {
        const decision = await this.store.claim(id, owner, chat, approve);
        if (!decision) return { text: "Persetujuan tidak tersedia atau sudah digunakan. Jika perubahan pernah diproses, periksa catatan sebelum mencoba lagi." };
        return this.execute(owner, chat, decision.run, options => approve
            ? this.agent.approveToolCallGenerate({ ...options, runId: decision.native_run, toolCallId: decision.call_id, memory: { resource: owner, thread: chat } })
            : this.agent.declineToolCallGenerate({ ...options, runId: decision.native_run, toolCallId: decision.call_id, reason: "Pengguna menolak perubahan ini.", memory: { resource: owner, thread: chat } }), decision.native_run);
    }
}
