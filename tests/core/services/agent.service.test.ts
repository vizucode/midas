import { afterEach, describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { createTool } from "@mastra/core/tools";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { z } from "zod";
import { ApprovalStore, canonical, fingerprint } from "../../../src/core/services/approval.store";

const url = () => `file:/tmp/midas-${crypto.randomUUID()}.db`;
const stores: ApprovalStore[] = [];
const make = async () => { const store = new ApprovalStore(url(), undefined, 60000, 60000); await store.init(); stores.push(store); return store; };
afterEach(() => stores.splice(0).forEach(store => store.close()));

describe("durable financial approval", () => {
    test("native Mastra approval persists across store restart", async () => {
        const database = url();
        let writes = 0;
        const tool = createTool({ id: "write", description: "Write fixture", inputSchema: z.object({ amount: z.number() }), requireApproval: true, execute: async () => { writes++; return { saved: true }; } });
        const makeModel = (call: boolean) => new MastraLanguageModelV2Mock({ doGenerate: async () => ({ content: call ? [{ type: "tool-call", toolCallId: "call-1", toolName: "write", input: '{"amount":1}' }] : [{ type: "text", text: "Done" }], finishReason: call ? "tool-calls" : "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] }) });
        const firstStorage = new LibSQLStore({ id: "first", url: database });
        const first = new Agent({ id: "native-test", name: "Native test", instructions: "Test", model: makeModel(true), tools: { write: tool } });
        new Mastra({ agents: { first }, storage: firstStorage });
        const pending = await first.generate("Write amount one", { maxSteps: 1 });
        expect(pending.finishReason).toBe("suspended");
        expect(writes).toBe(0);
        await firstStorage.close();
        const secondStorage = new LibSQLStore({ id: "second", url: database });
        const second = new Agent({ id: "native-test", name: "Native test", instructions: "Test", model: makeModel(false), tools: { write: tool } });
        new Mastra({ agents: { second }, storage: secondStorage });
        await second.approveToolCallGenerate({ runId: pending.runId!, toolCallId: "call-1", maxSteps: 1 });
        expect(writes).toBe(1);
        await secondStorage.close();
    });
    test("canonical fingerprints bind exact arguments", () => {
        expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
        expect(fingerprint("write", { amount: 1 }, "v1")).not.toBe(fingerprint("write", { amount: 2 }, "v1"));
    });
    test("claims once and rejects wrong owner or chat", async () => {
        const store = await make(); const run = await store.start("u1", "c1"); await store.finish(run, "waiting"); const id = await store.pending(run, "native", "call", "write", { amount: 1 }, "v1");
        expect(await store.claim(id, "u2", "c1", true)).toBeUndefined();
        expect(await store.claim(id, "u1", "c2", true)).toBeUndefined();
        expect(await store.claim(id, "u1", "c1", true)).toMatchObject({ run, call_id: "call" });
        expect(await store.claim(id, "u1", "c1", true)).toBeUndefined();
    });
    test("reopened database preserves pending approval", async () => {
        const database = url(); const first = new ApprovalStore(database); await first.init(); const run = await first.start("u", "c"); await first.finish(run, "waiting"); const id = await first.pending(run, "native", "call", "write", {}, "v1"); first.close();
        const second = new ApprovalStore(database); await second.init(); expect(await second.claim(id, "u", "c", false)).toMatchObject({ run }); second.close();
    });
    test("deduplicates delivery", async () => { const store = await make(); expect(await store.delivery("1")).toBe(true); expect(await store.delivery("1")).toBe(false); });
    test("binds execution to claimed exact call", async () => {
        const store = await make(); const run = await store.start("u", "c"); await store.finish(run, "waiting"); const id = await store.pending(run, "native", "call", "write", { amount: 1 }, "v1"); await store.claim(id, "u", "c", true);
        await expect(store.execute(run, "u", "c", "native", "call", "write", { amount: 2 }, "v1", true, "changed")).rejects.toThrow("Approval mismatch");
        await expect(store.execute(run, "u", "c", "native", "call", "write", { amount: 1 }, "v1", true, "exact")).resolves.toBeUndefined();
        await expect(store.execute(run, "u", "c", "native", "call", "write", { amount: 1 }, "v1", true, "again")).rejects.toThrow("Approval mismatch");
    });
    test("enforces thirty execution budget", async () => {
        const store = await make(); const run = await store.start("u", "c");
        for (let i = 0; i < 30; i++) await store.execute(run, "u", "c", run, `c${i}`, "read", { i }, "v1", false, String(i));
        await expect(store.execute(run, "u", "c", run, "c30", "read", {}, "v1", false, "30")).rejects.toThrow("Execution budget exhausted");
    });
});
