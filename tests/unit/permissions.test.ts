import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_GROUPS, can, canAny, isPermission, parsePermissions, resolvePermissions } from "@/lib/permissions";

describe("permissions", () => {
  it("le catalogue contient 16 permissions uniques", () => {
    expect(PERMISSIONS).toHaveLength(16);
    expect(new Set(PERMISSIONS).size).toBe(16);
  });
  it("les groupes couvrent exactement le catalogue", () => {
    expect(PERMISSION_GROUPS.flatMap((g) => g.permissions).sort()).toEqual([...PERMISSIONS].sort());
  });
  it("isPermission / parsePermissions filtrent les valeurs inconnues", () => {
    expect(isPermission("leads.create")).toBe(true);
    expect(isPermission("hack.all")).toBe(false);
    expect(parsePermissions(["leads.create", "nope"])).toEqual(["leads.create"]);
  });
  it("un admin possède toutes les permissions", () => {
    expect(resolvePermissions(true, [])).toHaveLength(PERMISSIONS.length);
    expect(resolvePermissions(false, ["dashboard.view"])).toEqual(["dashboard.view"]);
  });
  it("can / canAny", () => {
    expect(can(["leads.edit"], "leads.edit")).toBe(true);
    expect(can(["leads.edit"], "roles.manage")).toBe(false);
    expect(can([], "roles.manage", true)).toBe(true);
    expect(canAny(["leads.edit"], ["roles.manage", "leads.edit"])).toBe(true);
    expect(canAny([], ["roles.manage"])).toBe(false);
  });
});
