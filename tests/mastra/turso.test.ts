import { describe, expect, test } from "bun:test";
import { tursoConfig } from "../../src/mastra/turso";

describe("Turso configuration", () => {
    test("loads host and token from environment", () => {
        expect(tursoConfig({ TURSO_HOST: "libsql://midas.turso.io", TURSO_TOKEN: "secret" })).toEqual({
            host: "libsql://midas.turso.io",
            token: "secret",
        });
    });

    test("rejects missing credentials", () => {
        expect(() => tursoConfig({ TURSO_HOST: "libsql://midas.turso.io" })).toThrow("TURSO_TOKEN is required");
        expect(() => tursoConfig({ TURSO_TOKEN: "secret" })).toThrow("TURSO_HOST is required");
    });

    test("rejects unsafe or malformed hosts", () => {
        expect(() => tursoConfig({ TURSO_HOST: "file:./midas.db", TURSO_TOKEN: "secret" })).toThrow("valid remote libSQL URL");
        expect(() => tursoConfig({ TURSO_HOST: "https://user:pass@midas.turso.io", TURSO_TOKEN: "secret" })).toThrow("valid remote libSQL URL");
    });
});
