import { describe, expect, test } from "bun:test";
import { classifyFinanceScope } from "../../../src/core/services/finance.guardrail";

describe("finance scope guardrail", () => {
    for (const message of [
        "Catat pengeluaran makan Rp50.000",
        "What is my account balance?",
        "Tolong buat anggaran bulanan",
        "Bagaimana cara mencatat utang?",
    ]) test(`allows finance request: ${message}`, () => {
        expect(classifyFinanceScope(message)).toBe("finance");
    });

    for (const message of ["Halo", "Kamu bisa apa?", "Tolong bantu cara pakai bot ini"]) {
        test(`allows bot help: ${message}`, () => {
            expect(classifyFinanceScope(message)).toBe("bot_help");
        });
    }

    for (const message of ["Buatkan resep nasi goreng", "Siapa presiden Indonesia?", "Tulis kode Python untuk API"]) {
        test(`blocks unrelated request: ${message}`, () => {
            expect(classifyFinanceScope(message)).toBe("out_of_scope");
        });
    }
});
