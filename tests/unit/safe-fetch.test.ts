import { describe, expect, it } from "vitest";
import { isForbiddenHost } from "@/lib/net/ip";
import { safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";

describe("isForbiddenHost", () => {
  const forbidden = [
    "localhost", "a.localhost", "x.local", "metadata.google.internal", "0.0.0.0", "0.1.2.3", "10.1.2.3", "127.0.0.1", "100.64.0.1", "100.127.255.255",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.1.1.1", "255.255.255.255", "240.0.0.1",
    "[::1]", "::", "fe80::1", "[fe80::abcd]", "fc00::1", "fd12::1", "ff02::1", "[::ffff:127.0.0.1]", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1", "[64:ff9b::a00:1]", "2002:7f00:1::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "::7f00:1", "", "0x7f000001", "127.1",
  ];
  const allowed = ["example.com", "hooks.example.com", "8.8.8.8", "1.1.1.1", "100.63.255.255", "172.32.0.1", "198.20.0.1", "2606:4700:4700::1111", "::ffff:808:808", "2002:808:808::"];
  for (const h of forbidden) it(`interdit ${h || "(vide)"}`, () => expect(isForbiddenHost(h)).toBe(true));
  for (const h of allowed) it(`autorise ${h}`, () => expect(isForbiddenHost(h)).toBe(false));
});

describe("safeFetch", () => {
  it("refuse http, hôtes internes et identifiants", async () => {
    for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1/", "https://[::1]/", "https://user:pw@example.com/", "nope", "https://100.64.0.1/"]) {
      await expect(safeFetch(u), u).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });
  it("refuse un nom qui résout vers une IP privée (localtest.me -> 127.0.0.1)", async () => {
    await expect(safeFetch("https://localtest.me/")).rejects.toBeDefined();
  });
});
