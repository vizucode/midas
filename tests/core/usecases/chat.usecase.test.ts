import { describe, expect, test } from "bun:test";
import { ChatService, formatApproval, scopeReply } from "../../../src/core/usecases/chat.usecase";

describe("chat policy", () => {
    test("shows exact operation arguments", () => expect(formatApproval({ name: "create_records", args: { records: [{ amount: -17000, note: "Ayam goreng" }] } })).toContain("Ayam goreng"));
    test("rejects empty approval previews", () => expect(() => formatApproval({ name: "create_budget", args: {} })).toThrow("Invalid approval preview"));
    test("keeps help deterministic", () => expect(scopeReply("Halo")).toContain("asisten keuangan"));
    test("generates natural out-of-scope reply with isolated memory IDs", async () => {
        let identity: string[] = [];
        const chat = new ChatService({} as never, {} as never, {}, async (text, owner, thread) => {
            identity = [owner, thread];
            return `Wah, ${text.includes("cendol") ? "cendol memang menarik" : "topik itu menarik"}, tapi aku lebih cocok bantu keuanganmu.`;
        });
        expect((await chat.message("owner", "chat", "Apakah kamu tahu resep cendol?")).text).toContain("cendol memang menarik");
        expect(identity).toEqual(["owner", "chat"]);
    });
    test("passes greetings to natural reply generator", async () => {
        const chat = new ChatService({} as never, {} as never, {}, async text => `Hai juga! Pesanmu: ${text}`);
        expect((await chat.message("owner", "chat", "Halo")).text).toBe("Hai juga! Pesanmu: Halo");
    });
    test("falls back when out-of-scope generation fails", async () => {
        const chat = new ChatService({} as never, {} as never, {}, async () => { throw new Error("provider unavailable"); });
        expect((await chat.message("owner", "chat", "Buatkan resep nasi goreng")).text).toContain("Aku belum bisa bantu");
    });
});
