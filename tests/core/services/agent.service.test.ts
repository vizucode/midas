import { describe, expect, mock, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { fakeModel } from "langchain";
import { z } from "zod";
import { createFinancialAgent } from "../../../src/core/services/agent.service";

const readTools = [
    "get_client_profile",
    "get_records",
    "get_accounts",
    "get_categories",
    "get_budgets",
    "get_labels",
    "get_records_aggregation",
    "get_entity",
    "get_references",
];

const writeTools = [
    "create_records",
    "create_account",
    "create_budget",
    "create_category",
    "create_label",
    "patch_records",
    "patch_accounts",
    "patch_budgets",
    "patch_categories",
    "patch_labels",
    "delete_documents",
];

type ToolRun = ReturnType<typeof mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>>;

function makeTool(name: string, run: ToolRun) {
    return tool(run, {
        name,
        description: `${name} test tool`,
        schema: z.object({}).passthrough(),
    });
}

function createTestAgent(name: string, run: ToolRun, final = "Done") {
    const model = fakeModel()
        .respondWithTools([{ name, args: { fixture: true }, id: "call_1" }])
        .respond(new AIMessage(final));

    return createFinancialAgent(model, [makeTool(name, run)]);
}

describe("financial agent MCP tools", () => {
    for (const name of readTools) test(`calls read tool ${name} without confirmation`, async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "tool response",
        );
        const agent = createTestAgent(name, run, `${name} complete`);

        const result = await agent.invoke(
            { messages: [{ role: "user", content: `Use ${name}` }] },
            { configurable: { thread_id: name } },
        );

        expect(run).toHaveBeenCalledWith({ fixture: true }, expect.anything());
        expect(result.messages.at(-1)?.content).toBe(`${name} complete`);
    });

    test("removes empty optional enum fields before calling MCP", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "tool response",
        );
        const model = fakeModel()
            .respondWithTools([{
                name: "get_client_profile",
                args: { help: [""], source: ["", "  "], recordState: null, accountId: "", categoryId: null, limit: 10 },
                id: "call_1",
            }])
            .respond(new AIMessage("Done"));
        const agent = createFinancialAgent(model, [makeTool("get_client_profile", run)]);

        await agent.invoke(
            { messages: [{ role: "user", content: "Get profile" }] },
            { configurable: { thread_id: "filter-guard" } },
        );

        expect(run).toHaveBeenCalledWith({ limit: 10 }, expect.anything());
    });

    test("removes categoryGroup for all transaction queries", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "records",
        );
        const model = fakeModel()
            .respondWithTools([{
                name: "get_records",
                args: { recordDate: ["eq.2026-10-05"], recordType: "expense", categoryGroup: "housing" },
                id: "all-records",
            }])
            .respond(new AIMessage("Done"));
        const agent = createFinancialAgent(model, [makeTool("get_records", run)]);

        await agent.invoke(
            { messages: [{ role: "user", content: "Pengeluaran kemarin" }] },
            { configurable: { thread_id: "all-records" } },
        );

        expect(run).toHaveBeenCalledWith(
            { recordDate: ["eq.2026-10-05"], recordType: "expense" },
            expect.anything(),
        );
    });

    test("preserves categoryId for custom categories", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "records",
        );
        const model = fakeModel()
            .respondWithTools([{ name: "get_records", args: { categoryId: "custom-id", categoryGroup: "unknown_records" }, id: "category_call" }])
            .respond(new AIMessage("Done"));
        const agent = createFinancialAgent(model, [makeTool("get_records", run)]);

        await agent.invoke(
            { messages: [{ role: "user", content: "Transaksi kategori custom" }] },
            { configurable: { thread_id: "custom-category" } },
        );

        expect(run).toHaveBeenCalledWith(
            { categoryId: "custom-id" },
            expect.anything(),
        );
    });

    test("removes categoryGroup from all-transaction aggregation", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "aggregation",
        );
        const model = fakeModel()
            .respondWithTools([{ name: "get_records_aggregation", args: { groupBy: ["category:name"], categoryGroup: "food_and_drinks" }, id: "all_call" }])
            .respond(new AIMessage("Done"));
        const agent = createFinancialAgent(model, [makeTool("get_records_aggregation", run)]);

        await agent.invoke(
            { messages: [{ role: "user", content: "Semua transaksi" }] },
            { configurable: { thread_id: "all-category" } },
        );

        expect(run).toHaveBeenCalledWith({ groupBy: ["category:name"] }, expect.anything());
    });

    test("removes categoryGroup and stops repeated category aggregation", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "aggregation result",
        );
        const model = fakeModel()
            .respondWithTools([{ name: "get_records_aggregation", args: { groupBy: ["category:name"], categoryGroup: "shopping" }, id: "call_1" }])
            .respond(new AIMessage("Report complete"));
        const agent = createFinancialAgent(model, [makeTool("get_records_aggregation", run)]);

        const result = await agent.invoke(
            { messages: [{ role: "user", content: "Spending by category" }] },
            { configurable: { thread_id: "category-report" }, recursionLimit: 12 },
        );

        expect(result.messages.at(-1)?.content).toBe("Report complete");
        expect(run).toHaveBeenCalledWith({ groupBy: ["category:name"] }, expect.anything());
    });

    test("exposes structured MCP artifacts as tool content", async () => {
        const model = fakeModel()
            .respondWithTools([{ name: "get_records_aggregation", args: {}, id: "artifact_call" }])
            .respond(new AIMessage("Done"));
        const resultTool = tool(async () => ({
            content: [],
            artifact: [{ data: { results: [{ total: 42 }] } }],
        }), {
            name: "get_records_aggregation",
            description: "Aggregation",
            schema: z.object({}),
        });
        const agent = createFinancialAgent(model, [resultTool]);
        const result = await agent.invoke(
            { messages: [{ role: "user", content: "Report" }] },
            { configurable: { thread_id: "artifact" } },
        );

        expect(result.messages.at(-1)?.content).toBe("Done");
    });

    test("blocks duplicate MCP tool calls before recursion limit", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "tool response",
        );
        const model = fakeModel()
            .respondWithTools([{ name: "get_records", args: {}, id: "call_1" }])
            .respondWithTools([{ name: "get_records", args: {}, id: "call_2" }]);
        const agent = createFinancialAgent(model, [makeTool("get_records", run)]);

        await expect(agent.invoke(
            { messages: [{ role: "user", content: "Loop" }] },
            { configurable: { thread_id: "tool-limit" }, recursionLimit: 12 },
        )).rejects.toThrow("Duplicate MCP tool call blocked");
        expect(run).toHaveBeenCalledTimes(1);
    });

    test("resets duplicate detection for each user message", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "tool response",
        );
        const model = fakeModel()
            .respondWithTools([{ name: "get_records", args: {}, id: "call_1" }])
            .respond(new AIMessage("First done"))
            .respondWithTools([{ name: "get_records", args: {}, id: "call_2" }])
            .respond(new AIMessage("Second done"));
        const agent = createFinancialAgent(model, [makeTool("get_records", run)]);
        const config = { configurable: { thread_id: "multi-turn" } };

        await agent.invoke({ messages: [{ role: "user", content: "First" }] }, config);
        await agent.invoke({ messages: [{ role: "user", content: "Second" }] }, config);

        expect(run).toHaveBeenCalledTimes(2);
    });

    for (const name of writeTools) test(`requires confirmation before ${name} executes`, async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "tool response",
        );
        const agent = createTestAgent(name, run, `${name} complete`);
        const config = { configurable: { thread_id: name } };

        const paused = await agent.invoke(
            { messages: [{ role: "user", content: `Use ${name}` }] },
            config,
        );

        expect(paused.__interrupt__).toHaveLength(1);
        expect(run).not.toHaveBeenCalled();

        const completed = await agent.invoke(
            new Command({ resume: { decisions: [{ type: "approve" }] } }),
            config,
        );

        expect(run).toHaveBeenCalledWith({ fixture: true }, expect.anything());
        expect(completed.messages.at(-1)?.content).toBe(`${name} complete`);
    });
});
