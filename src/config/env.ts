const BOT_TOKEN = Bun.env.BOT_TOKEN?.trim();
const NINE_ROUTER_BASE_URL = Bun.env.NINE_ROUTER_BASE_URL?.trim();
const NINE_ROUTER_API_KEY = Bun.env.NINE_ROUTER_API_KEY?.trim();
const NINE_ROUTER_MODEL = Bun.env.NINE_ROUTER_MODEL?.trim();
const MCP_SERVER_URL = Bun.env.MCP_SERVER_URL?.trim();
const MCP_SERVER_AUTH_TOKEN = Bun.env.MCP_SERVER_AUTH_TOKEN?.trim();
const MCP_SERVER_AUTH_HEADER = Bun.env.MCP_SERVER_AUTH_HEADER?.trim() || "Bearer";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN wajib diisi di file .env");
}

if (!NINE_ROUTER_BASE_URL) {
  throw new Error("NINE_ROUTER_BASE_URL wajib diisi di file .env");
}

if (!NINE_ROUTER_API_KEY) {
  throw new Error("NINE_ROUTER_API_KEY wajib diisi di file .env");
}

if (!NINE_ROUTER_MODEL) {
  throw new Error("NINE_ROUTER_MODEL wajib diisi di file .env");
}

if (!MCP_SERVER_URL) {
  throw new Error("MCP_SERVER_URL wajib diisi di file .env");
}

if (!MCP_SERVER_AUTH_TOKEN) {
  throw new Error("MCP_SERVER_AUTH_TOKEN wajib diisi di file .env");
}

export const env = {
  BOT_TOKEN,
  NINE_ROUTER_BASE_URL,
  NINE_ROUTER_API_KEY,
  NINE_ROUTER_MODEL,
  MCP_SERVER_URL,
  MCP_SERVER_AUTH_TOKEN,
  MCP_SERVER_AUTH_HEADER,
} as const;
