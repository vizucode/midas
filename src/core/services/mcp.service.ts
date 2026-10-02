import { MultiServerMCPClient } from "@langchain/mcp-adapters";

let mcpClient: MultiServerMCPClient | undefined;

export async function getMcpTools() {
    const url = process.env.MCP_SERVER_URL;
    if (!url) throw new Error("Missing env: MCP_SERVER_URL");

    const authToken = process.env.MCP_SERVER_AUTH_TOKEN;
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;

    mcpClient ??= new MultiServerMCPClient({
        mcpServers: {
            budgetBakers: { url, headers },
        },
    });

    return mcpClient.getTools();
}

export async function closeMcp() {
    await mcpClient?.close();
    mcpClient = undefined;
}
