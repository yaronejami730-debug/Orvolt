import { describe, expect, it } from "vitest";
import { buildCsp, makeNonce } from "@/lib/csp";

describe("CSP à nonce", () => {
  it("nonce unique par appel, script-src sans unsafe-inline, directives de durcissement", () => {
    const a = makeNonce();
    expect(a).not.toBe(makeNonce());
    const csp = buildCsp(a);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain(`'nonce-${a}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"]) expect(csp).toContain(d);
  });
});
