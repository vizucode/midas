import { describe, expect, test } from "bun:test";
import { formatApproval } from "../../../src/core/usecases/chat.usecase";

describe("formatApproval", () => {
    test("formats create_records as human confirmation", () => {
        expect(formatApproval({
            name: "create_records",
            args: {
                records: [
                    { amount: -17000, note: "Ayam goreng", recordDate: "2026-10-06", accountName: "Bank Utama" },
                    { amount: -3000, note: "Minuman", recordDate: "2026-10-06", accountName: "Bank Utama" },
                ],
            },
        })).toBe([
            "Konfirmasi pencatatan pengeluaran:",
            "• Ayam goreng — Rp17.000",
            "• Minuman — Rp3.000",
            "Akun: Bank Utama",
            "Tanggal: 6 Oktober 2026",
            "Total: Rp20.000",
            "Lanjut catat?",
        ].join("\n"));
    });

    test("uses generic confirmation for other tools", () => {
        expect(formatApproval({ name: "create_budget", args: {} })).toBe(
            "Konfirmasi diperlukan untuk melanjutkan perubahan keuangan. Lanjutkan?",
        );
    });
});
