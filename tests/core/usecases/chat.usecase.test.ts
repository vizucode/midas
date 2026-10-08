import { describe, expect, test } from "bun:test";
import { formatApproval, scopeReply } from "../../../src/core/usecases/chat.usecase";

describe("chat policy", () => {
    test("shows exact operation arguments", () => expect(formatApproval({ name: "create_records", args: { records: [{ amount: -17000, note: "Ayam goreng" }] } })).toContain("Ayam goreng"));
    test("rejects empty approval previews", () => expect(() => formatApproval({ name: "create_budget", args: {} })).toThrow("Invalid approval preview"));
    test("keeps help deterministic", () => expect(scopeReply("Halo")).toContain("asisten keuangan"));
});
