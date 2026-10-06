const financeTerms = [
    "account", "accounting", "asset", "balance", "bank", "budget", "cash", "category",
    "debit", "debt", "expense", "finance", "financial", "income", "invoice", "investment",
    "ledger", "liability", "money", "payment", "profit", "rekening", "saldo", "anggaran",
    "aset", "akuntansi", "belanja", "biaya", "bisnis", "buku besar", "cicilan", "debit",
    "hutang", "utang", "spending", "investasi", "kredit", "laba", "pajak", "pemasukan", "pembayaran", "pengeluaran",
    "piutang", "tabungan", "tagihan", "transaksi", "transfer", "uang",
];

const botHelpPatterns = [
    /^(hai|halo|hello|hi|hey)\b/i,
    /\b(kamu siapa|bisa apa|cara pakai|bantuan|help)\b/i,
];

export type FinanceScope = "finance" | "bot_help" | "out_of_scope";

export function classifyFinanceScope(message: string): FinanceScope {
    const normalized = message.toLocaleLowerCase("id-ID");

    if (financeTerms.some((term) => normalized.includes(term))) return "finance";
    if (botHelpPatterns.some((pattern) => pattern.test(normalized))) return "bot_help";
    return "out_of_scope";
}
