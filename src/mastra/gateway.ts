import { MastraModelGateway, type ProviderConfig } from "@mastra/core/llm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible-v5";

export class NineRouterGateway extends MastraModelGateway {
    readonly id = "nine-router";
    readonly name = "NINE Router";
    async fetchProviders(): Promise<Record<string, ProviderConfig>> {
        const model = process.env.NINE_ROUTER_MODEL;
        if (!model) throw new Error("Missing env: NINE_ROUTER_MODEL");
        return { nine: { name: "NINE Router", models: [model], apiKeyEnvVar: "NINE_ROUTER_API_KEY", gateway: this.id, url: process.env.NINE_ROUTER_BASE_URL } };
    }
    buildUrl() { const url = process.env.NINE_ROUTER_BASE_URL; if (!url) throw new Error("Missing env: NINE_ROUTER_BASE_URL"); return url; }
    async getApiKey() { const key = process.env.NINE_ROUTER_API_KEY; if (!key) throw new Error("Missing env: NINE_ROUTER_API_KEY"); return key; }
    resolveLanguageModel({ modelId, providerId, apiKey }: { modelId: string; providerId: string; apiKey: string }) { return createOpenAICompatible({ name: providerId, apiKey, baseURL: this.buildUrl(), supportsStructuredOutputs: true }).chatModel(modelId); }
}
