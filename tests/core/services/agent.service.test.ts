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

    test("removes empty enum filters before calling MCP", async () => {
        const run = mock<(args: Record<string, unknown>, config: unknown) => Promise<string>>(
            async () => "tool response",
        );
        const model = fakeModel()
            .respondWithTools([{
                name: "get_records",
                args: { source: ["", "  "], recordState: null, limit: 10 },
                id: "call_1",
            }])
            .respond(new AIMessage("Done"));
        const agent = createFinancialAgent(model, [makeTool("get_records", run)]);

        await agent.invoke(
            { messages: [{ role: "user", content: "Get records" }] },
            { configurable: { thread_id: "filter-guard" } },
        );

        expect(run).toHaveBeenCalledWith({ limit: 10 }, expect.anything());
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
