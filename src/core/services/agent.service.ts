import { Agent } from "@mastra/core/agent";
import { createTool, type Tool } from "@mastra/core/tools";
import { standardSchemaToJSONSchema } from "@mastra/core/schema";
import { getMcpTools } from "./mcp.service";
import { ApprovalStore, canonical } from "./approval.store";

export const reads = new Set(["get_client_profile", "get_records", "get_accounts", "get_categories", "get_budgets", "get_labels", "get_records_aggregation", "get_entity", "get_references"]);
export const writes = new Set(["create_records", "create_account", "create_budget", "create_category", "create_label", "patch_records", "patch_accounts", "patch_budgets", "patch_categories", "patch_labels", "delete_documents"]);
export const instructions = `You are a financial assistant.
- Never include optional fields when their value is empty, null, unknown, or invalid. Only send optional enum fields with allowed values.
- For all-transactions requests omit categoryId and categoryGroup. Never query every category separately.
- For a specific category call get_categories to resolve its real name and ID, including custom categories. If no unique match exists ask for clarification.
- Do not use categoryGroup with get_records. Its response includes each transaction's category.
- For transaction listings and largest category use one get_records and one get_records_aggregation with category:name grouping and baseAmount:absSum.
- For all-category spending use get_records_aggregation with category:name and baseAmount:absSum; omit categoryId and categoryGroup.
- Do not call get_client_profile unless asked about profile, permissions, sync, or settings.
- Once sufficient data is received, stop calling tools and answer.
- Reply naturally and warmly in Indonesian. Lead with an insight, then concise details. Use plain Telegram-friendly text, without markdown, raw API data, or jargon.
- For account lists mention total balance, highlight notable balances, group zero-balance accounts, and end with a useful follow-up question.
- Explain errors plainly, suggest a next step. For confirmations state action, amount, account, and date. Never claim zero balance or no data after a tool error.
- Use a friendly-professional tone; slang only when natural. Keep tool names, field names, enums, dates, and numbers exactly as required by MCP schema; do not translate tool arguments.`;

export function normalize(name: string, input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    const args = Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, value]) => value != null && (typeof value !== "string" || value.trim() !== "") && (!Array.isArray(value) || !value.length || !value.every(x => typeof x === "string" && !x.trim()))));
    if (name === "get_records") delete args.categoryGroup;
    if (name === "get_records_aggregation" && Array.isArray(args.groupBy) && args.groupBy.includes("category:name")) { delete args.categoryId; delete args.categoryGroup; }
    return args;
}

export function contractsFor(tools: Awaited<ReturnType<typeof getMcpTools>>) {
    return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, canonical(standardSchemaToJSONSchema(tool.inputSchema!, { io: "input" }))]));
}

export async function createFinancialAgent(store: ApprovalStore, supplied?: Awaited<ReturnType<typeof getMcpTools>>) {
    const remote = supplied ?? await getMcpTools();
    const contracts = contractsFor(remote);
    const tools: Record<string, Tool<any, any>> = {};
    for (const [qualified, source] of Object.entries(remote)) {
        if (!qualified.startsWith("budgetBakers_") || !source.inputSchema || !source.execute) throw new Error(`Unsupported MCP tool: ${qualified}`);
        const name = qualified.slice("budgetBakers_".length);
        if (!reads.has(name) && !writes.has(name)) throw new Error(`Unclassified MCP tool: ${qualified}`);
        tools[qualified] = createTool({ id: qualified, description: source.description, inputSchema: source.inputSchema, requireApproval: writes.has(name), execute: async (input, context) => {
            const request = context?.requestContext;
            const run = request?.get("appRunId"), owner = request?.get("ownerId"), chat = request?.get("chatId");
            if (![run, owner, chat].every(x => typeof x === "string")) throw new Error("Missing trusted execution identity");
            const args = normalize(name, input);
            if (writes.has(name) && canonical(input) !== canonical(args)) throw new Error("Reviewed arguments differ from executable arguments");
            const nativeRun = String(request?.get("nativeRunId") ?? run);
            const callId = context?.agent?.toolCallId ?? "";
            const key = name === "get_records_aggregation" && Array.isArray((args as Record<string, unknown>).groupBy) && ((args as Record<string, unknown>).groupBy as unknown[]).includes("category:name") ? "category-aggregation" : `${qualified}:${canonical(args)}`;
            await store.execute(String(run), String(owner), String(chat), nativeRun, callId, qualified, args, contracts[qualified]!, writes.has(name), key);
            try { return await source.execute!(args, context as never); } catch (error) { await store.fail(String(run)); throw error; }
        } });
    }
    return new Agent({ id: "financial-agent", name: "Midas", instructions, model: (`nine-router/nine/${process.env.NINE_ROUTER_MODEL}`) as never, tools, defaultOptions: { maxSteps: 30 } });
}
export type FinancialAgent = Awaited<ReturnType<typeof createFinancialAgent>>;
