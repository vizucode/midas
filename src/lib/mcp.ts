import { env } from "../config/env";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id?: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type McpToolCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

let requestId = 1;
let sessionId: string | null = null;
let initialized = false;
let cachedTools: McpTool[] | null = null;

function getHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `${env.MCP_SERVER_AUTH_HEADER} ${env.MCP_SERVER_AUTH_TOKEN}`,
    ...extra,
  };

  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
    headers["MCP-Protocol-Version"] = "2025-06-18";
  }

  return headers;
}

async function post<T>(body: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
  const response = await fetch(env.MCP_SERVER_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const nextSessionId = response.headers.get("Mcp-Session-Id");
  if (nextSessionId) {
    sessionId = nextSessionId;
  }

  if (!response.ok) {
    throw new Error(`MCP error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as JsonRpcResponse<T>;
}

async function initialize(): Promise<void> {
  if (initialized) {
    return;
  }

  const initResponse = await post<{ protocolVersion?: string }>({
    jsonrpc: "2.0",
    id: requestId++,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "tele-finance-asisstant",
        version: "1.0.0",
      },
    },
  });

  if (initResponse.error) {
    throw new Error(`MCP initialize failed: ${initResponse.error.message}`);
  }

  await post<void>({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  initialized = true;
}

export async function listMcpTools(refresh = false): Promise<McpTool[]> {
  await initialize();

  if (cachedTools && !refresh) {
    return cachedTools;
  }

  const response = await post<{ tools?: McpTool[] }>({
    jsonrpc: "2.0",
    id: requestId++,
    method: "tools/list",
  });

  if (response.error) {
    throw new Error(`MCP tools/list failed: ${response.error.message}`);
  }

  cachedTools = response.result?.tools || [];
  return cachedTools;
}

export async function callMcpTool(name: string, args: unknown): Promise<string> {
  await initialize();

  const response = await post<McpToolCallResult>({
    jsonrpc: "2.0",
    id: requestId++,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });

  if (response.error) {
    throw new Error(`MCP tools/call failed: ${response.error.message}`);
  }

  const result = response.result;

  if (!result) {
    return "";
  }

  const text = result.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (text) {
    return text;
  }

  if (result.structuredContent) {
    return JSON.stringify(result.structuredContent);
  }

  return "";
}

export function getOpenAiTools(tools: McpTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
      },
    },
  }));
}
