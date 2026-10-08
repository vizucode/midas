import { createClient, type Client, type InValue } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";

export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    return JSON.stringify(value);
}
export const fingerprint = (name: string, args: unknown, contract: string) => createHash("sha256").update(canonical({ name, args, contract, policy: 1 })).digest("hex");
export type Decision = { id: string; run: string; native_run: string; call_id: string; name: string; args: string; fingerprint: string };

export class ApprovalStore {
    readonly client: Client;
    constructor(url: string, authToken?: string, readonly expiryMs = 86400000, readonly retentionMs = 2592000000) {
        this.client = createClient({ url, authToken });
    }
    query(sql: string, args: InValue[] = []) { return this.client.execute({ sql, args }); }
    async init() {
        await this.client.batch([
            "CREATE TABLE IF NOT EXISTS midas_requests (id TEXT PRIMARY KEY,owner TEXT NOT NULL,chat TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',calls INTEGER NOT NULL DEFAULT 0,elapsed INTEGER NOT NULL DEFAULT 0,active_since INTEGER,possible_write INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL)",
            "CREATE TABLE IF NOT EXISTS midas_decisions (id TEXT PRIMARY KEY,run TEXT NOT NULL,native_run TEXT NOT NULL,call_id TEXT NOT NULL,name TEXT NOT NULL,args TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',expires INTEGER NOT NULL,UNIQUE(run,native_run,call_id))",
            "CREATE TABLE IF NOT EXISTS midas_executions (run TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(run,key))",
            "CREATE TABLE IF NOT EXISTS midas_updates (id TEXT PRIMARY KEY,created INTEGER NOT NULL)",
        ], "write");
        await this.query("UPDATE midas_requests SET status='uncertain',active_since=NULL WHERE status='active'");
        await this.query("UPDATE midas_decisions SET status='expired' WHERE status='pending' AND expires<?", [Date.now()]);
        await this.query("DELETE FROM midas_updates WHERE created<?", [Date.now() - this.retentionMs]);
        await this.query("DELETE FROM midas_decisions WHERE expires<? AND status NOT IN ('claimed','executing')", [Date.now() - this.retentionMs]);
        await this.query("DELETE FROM midas_executions WHERE run IN (SELECT id FROM midas_requests WHERE created<? AND status='done')", [Date.now() - this.retentionMs]);
        await this.query("DELETE FROM midas_requests WHERE created<? AND status='done'", [Date.now() - this.retentionMs]);
    }
    async delivery(id: string) { return (await this.query("INSERT OR IGNORE INTO midas_updates VALUES(?,?)", [id, Date.now()])).rowsAffected === 1; }
    async start(owner: string, chat: string) {
        const id = randomUUID();
        await this.query("INSERT INTO midas_requests(id,owner,chat,active_since,created) VALUES(?,?,?,?,?)", [id, owner, chat, Date.now(), Date.now()]);
        return id;
    }
    async remaining(run: string) {
        const { rows } = await this.query("SELECT elapsed,active_since FROM midas_requests WHERE id=?", [run]);
        if (!rows[0]) throw new Error("Unknown request");
        return 120000 - Number(rows[0].elapsed) - (rows[0].active_since == null ? 0 : Date.now() - Number(rows[0].active_since));
    }
    async finish(run: string, status: "waiting" | "done" | "uncertain") {
        await this.query("UPDATE midas_requests SET elapsed=elapsed+MAX(0,?-COALESCE(active_since,?)),active_since=NULL,status=? WHERE id=?", [Date.now(), Date.now(), status, run]);
    }
    async pending(run: string, nativeRun: string, call: string, name: string, args: unknown, contract: string) {
        const id = randomUUID();
        await this.query("INSERT INTO midas_decisions(id,run,native_run,call_id,name,args,fingerprint,expires) VALUES(?,?,?,?,?,?,?,?)", [id, run, nativeRun, call, name, canonical(args), fingerprint(name, args, contract), Date.now() + this.expiryMs]);
        return id;
    }
    async claim(id: string, owner: string, chat: string, approve: boolean) {
        const tx = await this.client.transaction("write");
        try {
            const result = await tx.execute({ sql: "UPDATE midas_decisions SET status=? WHERE id=? AND status='pending' AND expires>? AND EXISTS(SELECT 1 FROM midas_requests WHERE id=midas_decisions.run AND owner=? AND chat=? AND status='waiting') RETURNING *", args: [approve ? "claimed" : "rejected", id, Date.now(), owner, chat] });
            const row = result.rows[0];
            if (row) await tx.execute({ sql: "UPDATE midas_requests SET status='active',active_since=? WHERE id=?", args: [Date.now(), row.run!] });
            await tx.commit();
            return row as unknown as Decision | undefined;
        } catch (e) { await tx.rollback(); throw e; } finally { tx.close(); }
    }
    async execute(run: string, owner: string, chat: string, nativeRun: string, call: string, name: string, args: unknown, contract: string, write: boolean, key: string) {
        const tx = await this.client.transaction("write");
        try {
            const budget = await tx.execute({ sql: "UPDATE midas_requests SET calls=calls+1,possible_write=MAX(possible_write,?) WHERE id=? AND owner=? AND chat=? AND status='active' AND calls<30 AND elapsed+?-active_since<120000", args: [write ? 1 : 0, run, owner, chat, Date.now()] });
            if (budget.rowsAffected !== 1) throw new Error("Execution budget exhausted");
            if (write) {
                const approval = await tx.execute({ sql: "UPDATE midas_decisions SET status='executing' WHERE run=? AND native_run=? AND call_id=? AND fingerprint=? AND status='claimed'", args: [run, nativeRun, call, fingerprint(name, args, contract)] });
                if (approval.rowsAffected !== 1) throw new Error("Approval mismatch");
            }
            await tx.execute({ sql: "INSERT INTO midas_executions VALUES(?,?)", args: [run, key] });
            await tx.commit();
        } catch (e) { await tx.rollback(); throw e; } finally { tx.close(); }
    }
    async fail(run: string) { await this.query("UPDATE midas_requests SET failed=1 WHERE id=?", [run]); }
    async outcome(run: string) { return (await this.query("SELECT failed,possible_write FROM midas_requests WHERE id=?", [run])).rows[0]!; }
    close() { this.client.close(); }
}
