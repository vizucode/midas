export type Env = {
  BOT_TOKEN: string;
  NINE_ROUTER_BASE_URL: string;
  NINE_ROUTER_API_KEY: string;
  NINE_ROUTER_MODEL: string;
  MCP_SERVER_URL: string;
  MCP_SERVER_AUTH_TOKEN: string;
  MCP_SERVER_AUTH_HEADER: string;
  TURSO_HOST: string;
  TURSO_TOKEN: string;
  AGENT_RECURSION_LIMIT: number;
};

const REQUIRED_KEYS = [
  "BOT_TOKEN",
  "NINE_ROUTER_BASE_URL",
  "NINE_ROUTER_API_KEY",
  "NINE_ROUTER_MODEL",
  "MCP_SERVER_URL",
  "MCP_SERVER_AUTH_TOKEN",
  "TURSO_HOST",
  "TURSO_TOKEN",
] as const;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const get = (key: string) => source[key]?.trim();

  for (const key of REQUIRED_KEYS) {
    if (!get(key)) throw new Error(`${key} wajib diisi (env var atau secret)`);
  }

  return {
    BOT_TOKEN: get("BOT_TOKEN")!,
    NINE_ROUTER_BASE_URL: get("NINE_ROUTER_BASE_URL")!,
    NINE_ROUTER_API_KEY: get("NINE_ROUTER_API_KEY")!,
    NINE_ROUTER_MODEL: get("NINE_ROUTER_MODEL")!,
    MCP_SERVER_URL: get("MCP_SERVER_URL")!,
    MCP_SERVER_AUTH_TOKEN: get("MCP_SERVER_AUTH_TOKEN")!,
    MCP_SERVER_AUTH_HEADER: get("MCP_SERVER_AUTH_HEADER") || "Bearer",
    TURSO_HOST: get("TURSO_HOST")!,
    TURSO_TOKEN: get("TURSO_TOKEN")!,
    AGENT_RECURSION_LIMIT: Number(get("AGENT_RECURSION_LIMIT")) || 15,
  };
}
