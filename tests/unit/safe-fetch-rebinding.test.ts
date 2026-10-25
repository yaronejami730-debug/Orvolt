import { beforeEach, describe, expect, it, vi } from "vitest";

// Résolveur DNS et transport https mockés : prouve une seule résolution, épinglage de l'IP, zéro redirection.
vi.mock("server-only", () => ({}));
const lookupMock = vi.fn();
const requestMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...a: unknown[]) => lookupMock(...a) }));
vi.mock("node:https", () => ({ request: (...a: unknown[]) => requestMock(...a) }));

import { safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";

function fakeRequest(status = 200) {
  requestMock.mockImplementation((opts: Record<string, unknown>, cb: (r: unknown) => void) => {
    const handlers: Record<string, () => void> = {};
    const req = {
      on: (e: string, h: () => void) => ((handlers[e] = h), req),
      end: () => cb({ statusCode: status, destroy: () => {} }),
      destroy: () => {},
      opts,
    };
    return req;
  });
}
beforeEach(() => {
  lookupMock.mockReset();
  requestMock.mockReset();
});

describe("safeFetch (DNS mocké)", () => {
  it("résout une seule fois et épingle l'IP validée, SNI/Host = nom d'origine", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    // une 2e résolution (rebinding) renverrait 127.0.0.1 : elle ne doit jamais être utilisée
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    fakeRequest();
    await safeFetch("https://rebind.example.com/hook", { body: "{}" });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    const opts = requestMock.mock.calls[0]![0] as { hostname: string; servername: string; lookup: (h: string, o: object, cb: (e: unknown, a: never) => void) => void };
    expect(opts.hostname).toBe("rebind.example.com");
    expect(opts.servername).toBe("rebind.example.com");
    const out: unknown[] = [];
    opts.lookup("rebind.example.com", {}, (_e: unknown, a: string) => out.push(a));
    opts.lookup("rebind.example.com", { all: true }, (_e: unknown, a: unknown) => out.push(a));
    expect(out[0]).toBe("93.184.216.34");
    expect(out[1]).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });
  it("refuse si une seule des IP résolues est privée (réponse multi-A)", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]);
    await expect(safeFetch("https://mixed.example.com/")).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("refuse les plages interdites renvoyées par DNS (v4 et v6)", async () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1", "::ffff:7f00:1", "64:ff9b::7f00:1", "fd00::1", "fe80::1"]) {
      lookupMock.mockResolvedValueOnce([{ address: a, family: a.includes(":") ? 6 : 4 }]);
      await expect(safeFetch("https://x.example.com/"), a).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    expect(requestMock).not.toHaveBeenCalled();
  });
  it("refuse schémas non https et littéraux IP sans résolution DNS", async () => {
    for (const u of ["http://a.example.com", "file:///etc/passwd", "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://169.254.169.254/", "https://u:p@a.example.com/"])
      await expect(safeFetch(u), u).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("ne suit pas les redirections : un 302 est renvoyé tel quel, une seule requête", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    fakeRequest(302);
    const r = await safeFetch("https://redir.example.com/");
    expect(r.status).toBe(302);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });
});

describe("safeFetch : délai total", () => {
  it("abandonne si le corps ne se termine jamais (délai total, pas seulement l'inactivité)", async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      let destroyed = false;
      requestMock.mockImplementation((_o: unknown, cb: (r: unknown) => void) => {
        const handlers: Record<string, (e?: Error) => void> = {};
        const req = {
          on: (e: string, h: (e?: Error) => void) => ((handlers[e] = h), req),
          // en-têtes reçus, mais le corps n'arrive jamais
          end: () => cb({ statusCode: 200, on: () => undefined, destroy: () => undefined }),
          destroy: (err?: Error) => { destroyed = true; handlers.error?.(err); },
        };
        return req;
      });
      const p = safeFetch("https://slow.example.com/", { maxBytes: 1000, timeoutMs: 1000 });
      const assertion = expect(p).rejects.toThrow(/timeout/);
      await vi.advanceTimersByTimeAsync(1100);
      await assertion;
      expect(destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("réussit sans déclencher le délai quand la réponse arrive à temps", async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      fakeRequest(204);
      await expect(safeFetch("https://fast.example.com/", { timeoutMs: 1000 })).resolves.toMatchObject({ status: 204 });
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});
