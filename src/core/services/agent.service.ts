import { Agent } from "@mastra/core/agent";
import { RegexFilterProcessor, UnicodeNormalizer } from "@mastra/core/processors";
import { standardSchemaToJSONSchema } from "@mastra/core/schema";
import { createTool, type Tool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
import { ApprovalStore, canonical } from "./approval.store";
import { getMcpTools } from "./mcp.service";

export const reads = new Set([
    "get_client_profile",
    "get_records",
    "get_accounts",
    "get_categories",
    "get_budgets",
    "get_labels",
    "get_records_aggregation",
    "get_entity",
    "get_references",
]);

export const writes = new Set([
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
]);

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
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return input;
    }

    const args = Object.fromEntries(
        Object.entries(input as Record<string, unknown>).filter(([, value]) => {
            if (value == null) {
                return false;
            }

            if (typeof value === "string") {
                return value.trim() !== "";
            }

            if (!Array.isArray(value) || value.length === 0) {
                return true;
            }

            return !value.every(item => typeof item === "string" && item.trim() === "");
        }),
    );

    if (name === "get_records") {
        delete args.categoryGroup;
    }

    const groupedByCategory = name === "get_records_aggregation"
        && Array.isArray(args.groupBy)
        && args.groupBy.includes("category:name");

    if (groupedByCategory) {
        delete args.categoryId;
        delete args.categoryGroup;
    }

    return args;
}

export function contractsFor(tools: Awaited<ReturnType<typeof getMcpTools>>) {
    return Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
        const schema = standardSchemaToJSONSchema(tool.inputSchema!, { io: "input" });
        return [name, canonical(schema)];
    }));
}

export function guardrails() {
    const normalizer = new UnicodeNormalizer({
        stripControlChars: true,
        preserveEmojis: true,
        collapseWhitespace: true,
        trim: true,
    });
    const promptInjectionFilter = new RegexFilterProcessor({
        strategy: "block",
        phase: "input",
        rules: [{
            name: "prompt-injection",
            pattern: /ignore\s+(all\s+)?previous|reveal\s+(the\s+)?system\s+prompt|jailbreak|bypass\s+(your\s+)?safety/i,
        }],
    });
    const systemPromptFilter = new RegexFilterProcessor({
        strategy: "redact",
        phase: "output",
        rules: [{
            name: "system-prompt",
            pattern: /system prompt|internal instructions/gi,
        }],
    });

    return {
        inputProcessors: [normalizer, promptInjectionFilter],
        outputProcessors: [systemPromptFilter],
    };
}

export const memory = new Memory({ options: { lastMessages: 20 } });

function operationName(toolName: string) {
    return toolName.slice("budgetBakers_".length);
}

function aggregationKey(toolName: string, args: unknown) {
    if (operationName(toolName) === "get_records_aggregation") {
        const groupBy = (args as Record<string, unknown>).groupBy;

        if (Array.isArray(groupBy) && groupBy.includes("category:name")) {
            return "category-aggregation";
        }
    }

    return `${toolName}:${canonical(args)}`;
}

export async function createFinancialAgent(store: ApprovalStore, supplied?: Awaited<ReturnType<typeof getMcpTools>>) {
    const remoteTools = supplied ?? await getMcpTools();
    const contracts = contractsFor(remoteTools);
    const tools: Record<string, Tool<any, any>> = {};

    for (const [qualifiedName, source] of Object.entries(remoteTools)) {
        if (!qualifiedName.startsWith("budgetBakers_") || !source.inputSchema || !source.execute) {
            throw new Error(`Unsupported MCP tool: ${qualifiedName}`);
        }

        const name = operationName(qualifiedName);
        const isRead = reads.has(name);
        const isWrite = writes.has(name);

        if (!isRead && !isWrite) {
            throw new Error(`Unclassified MCP tool: ${qualifiedName}`);
        }

        tools[qualifiedName] = createTool({
            id: qualifiedName,
            description: source.description,
            inputSchema: source.inputSchema,
            requireApproval: isWrite,
            execute: async (input, context) => {
                const request = context?.requestContext;
                const runId = request?.get("appRunId");
                const ownerId = request?.get("ownerId");
                const chatId = request?.get("chatId");

                if (![runId, ownerId, chatId].every(value => typeof value === "string")) {
                    throw new Error("Missing trusted execution identity");
                }

                const args = normalize(name, input);

                if (isWrite && canonical(input) !== canonical(args)) {
                    throw new Error("Reviewed arguments differ from executable arguments");
                }

                const nativeRunId = String(request?.get("nativeRunId") ?? runId);
                const toolCallId = context?.agent?.toolCallId ?? "";
                const key = aggregationKey(qualifiedName, args);

                await store.execute(
                    String(runId),
                    String(ownerId),
                    String(chatId),
                    nativeRunId,
                    toolCallId,
                    qualifiedName,
                    args,
                    contracts[qualifiedName]!,
                    isWrite,
                    key,
                );

                try {
                    return await source.execute!(args, context as never);
                } catch (error) {
                    await store.fail(String(runId));
                    throw error;
                }
            },
        });
    }

    return new Agent({
        id: "financial-agent",
        name: "Midas",
        instructions,
        model: (`nine-router/nine/${process.env.NINE_ROUTER_MODEL}`) as never,
        tools,
        memory,
        ...guardrails(),
        defaultOptions: { maxSteps: 30 },
    });
}

export type FinancialAgent = Awaited<ReturnType<typeof createFinancialAgent>>;
