import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBodyLimited } from "@/lib/net/body";
import { canSetApptStatus } from "@/lib/validation/appointments";
import { MAX_FILES_PER_LEAD } from "@/lib/validation/leads";

const MIG = path.join(__dirname, "../../supabase/migrations");
const migrations = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(path.join(MIG, f), "utf8");

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });

describe("readBodyLimited", () => {
  it("lit un corps sous la limite", async () => {
    expect(await readBodyLimited(stream(["abc", "def"]), 10)).toBe("abcdef");
  });
  it("refuse un corps trop gros (même découpé en morceaux)", async () => {
    expect(await readBodyLimited(stream(["abcd", "efgh", "ijkl"]), 10)).toBeNull();
  });
  it("corps absent = chaîne vide", async () => {
    expect(await readBodyLimited(null, 10)).toBe("");
  });
});

describe("confirmation d'un RDV", () => {
  it("seul un confirmateur passe un RDV à « Confirmé »", () => {
    expect(canSetApptStatus("confirmed", false)).toBe(false);
    expect(canSetApptStatus("confirmed", true)).toBe(true);
    for (const s of ["planned", "done", "cancelled", "no_show"] as const) expect(canSetApptStatus(s, false)).toBe(true);
  });
});

describe("plafond de fichiers", () => {
  it("le plafond applicatif reflète le trigger SQL", () => {
    expect(read("20260205000000_security_rls_hardening.sql")).toContain(`>= ${MAX_FILES_PER_LEAD}`);
  });
});

describe("migrations : garde-fous statiques", () => {
  it("toute fonction security definer fixe son search_path", () => {
    const bad: string[] = [];
    for (const f of migrations) {
      for (const m of read(f).matchAll(/create (?:or replace )?function\s+(?:public\.)?(\w+)\s*\([^)]*\)((?:(?!\bas\s+\$\$)[\s\S])*?)\bas\s+\$\$/gi)) {
        const header = m[2]!.toLowerCase();
        if (header.includes("security definer") && !header.includes("search_path")) bad.push(`${f}:${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("memberships : champs structurels et accès via_parent protégés", () => {
    const sql = read("20260205000000_security_rls_hardening.sql");
    expect(sql).toContain("memberships_immutable_guard");
    expect(sql).toContain("via_parent_locked");
    expect(sql).toContain("membership_immutable_fields");
    expect(sql).toContain("set_config('lf.parent_sync', 'on', true)");
  });

  it("un membre désactivé ne modifie plus ses propres lignes", () => {
    const sql = read("20260205000000_security_rls_hardening.sql");
    for (const p of ["lead_notes_update", "lead_notes_delete", "lead_calls_update", "lead_calls_delete", "tasks_update", "tasks_delete", "notifications_update", "notifications_delete", "zones_update", "zones_delete"]) {
      const m = new RegExp(`create policy ${p} on [\\s\\S]*?;`).exec(sql);
      expect(m?.[0], p).toContain("is_org_member(org_id)");
    }
  });

  it("verrouillage anon : fonctions et tables", () => {
    const sql = read("20260205000001_security_privileges_lockdown.sql");
    expect(sql).toContain("from public, anon");
    expect(sql).toContain("revoke all on all tables in schema public from anon");
  });
});
