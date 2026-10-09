export type TursoConfig = {
    host: string;
    token: string;
};

function requiredEnvironment(name: "TURSO_HOST" | "TURSO_TOKEN", environment: Record<string, string | undefined>): string {
    const value = environment[name]?.trim();

    if (!value) {
        throw new Error(`${name} is required`);
    }

    return value;
}

export function tursoConfig(environment: Record<string, string | undefined> = process.env): TursoConfig {
    const host = requiredEnvironment("TURSO_HOST", environment);
    const token = requiredEnvironment("TURSO_TOKEN", environment);

    let url: URL;

    try {
        url = new URL(host);
    } catch {
        throw new Error("TURSO_HOST must be a valid remote libSQL URL");
    }

    const secureProtocol = url.protocol === "libsql:" || url.protocol === "https:";

    if (!secureProtocol || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error("TURSO_HOST must be a valid remote libSQL URL");
    }

    return { host, token };
}
