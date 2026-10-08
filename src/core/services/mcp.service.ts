import { MCPClient } from "@mastra/mcp";

let client: MCPClient | undefined;
export async function getMcpTools() {
    const endpoint = process.env.MCP_SERVER_URL;
    if (!endpoint) throw new Error("Missing env: MCP_SERVER_URL");
    const token = process.env.MCP_SERVER_AUTH_TOKEN;
    client ??= new MCPClient({ servers: { budgetBakers: { url: new URL(endpoint), requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined, forwardInstructions: false, onToolError: "throw" } } });
    return client.listTools();
}
export async function closeMcp() { await client?.disconnect(); client = undefined; }
