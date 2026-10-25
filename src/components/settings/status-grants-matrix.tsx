"use client";

import { useMemo, useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { saveStatusGrantsAction } from "@/app/(app)/settings/statuses/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { StatusRow } from "./workflow-types";

export interface GrantRole {
  id: string;
  name: string;
  is_admin: boolean;
  system_key?: string | null;
}
export interface GrantRow {
  status_id: string;
  role_id: string;
  can_place: boolean;
  can_create: boolean;
}
interface Cell {
  place: boolean;
  create: boolean;
}

const key = (s: string, r: string) => `${s}:${r}`;

/**
 * Matrice « Qui peut poser quel statut » : lignes = statuts, colonnes = rôles.
 * « Poser » = utiliser ce statut comme destination d'un déplacement ; « À la création » = créer un lead directement dans ce statut
 * (le statut initial est toujours ouvert). Le super administrateur peut tout ; les autres ne peuvent accorder que ce qu'ils possèdent.
 */
export function StatusGrantsMatrix({ statuses, roles, grants, isSuperAdmin, myRoleId }: {
  statuses: StatusRow[];
  roles: GrantRole[];
  grants: GrantRow[];
  isSuperAdmin: boolean;
  myRoleId: string;
}) {
  const columns = roles.filter((r) => !r.is_admin);
  const superRole = roles.find((r) => r.is_admin);
  const initial = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const g of grants) m.set(key(g.status_id, g.role_id), { place: g.can_place, create: g.can_create });
    return m;
  }, [grants]);
  const [cells, setCells] = useState<Map<string, Cell>>(initial);
  const [pending, start] = useTransition();
  const get = (s: string, r: string): Cell => cells.get(key(s, r)) ?? { place: false, create: false };
  const mine = (s: string): Cell => initial.get(key(s, myRoleId)) ?? { place: false, create: false };
  const dirty = [...initial.keys(), ...cells.keys()].some((k) => {
    const a = initial.get(k) ?? { place: false, create: false };
    const b = cells.get(k) ?? { place: false, create: false };
    return a.place !== b.place || a.create !== b.create;
  });

  /** Verrou d'une colonne pour l'utilisateur courant (non super admin : pas son propre rôle ni l'Administrateur). */
  const columnLocked = (r: GrantRole) => !isSuperAdmin && (r.id === myRoleId || r.system_key === "administrator");

  function set(s: string, r: string, patch: Partial<Cell>) {
    setCells((cur) => {
      const next = new Map(cur);
      const c = { ...(cur.get(key(s, r)) ?? { place: false, create: false }), ...patch };
      if (!c.place) c.create = false;
      next.set(key(s, r), c);
      return next;
    });
  }

  function save() {
    const payload = statuses.flatMap((s) => columns.map((r) => ({ statusId: s.id, roleId: r.id, ...get(s.id, r.id) })));
    start(async () => {
      const res = await saveStatusGrantsAction({ grants: payload });
      if (res.ok) toast.success("Droits de statut enregistrés.");
      else toast.error(res.error);
    });
  }

  if (statuses.length === 0 || columns.length === 0) return null;

  return (
    <Card className="space-y-4 p-4 sm:p-5" data-testid="status-grants">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Qui peut poser quel statut</h2>
          <p className="text-sm text-muted-foreground">
            Pour chaque rôle, cochez les statuts qu&apos;il peut poser sur un lead. « À la création » l&apos;autorise aussi à créer un lead
            directement dans ce statut (le statut initial est toujours ouvert).
            {!isSuperAdmin && " Vous ne pouvez accorder que les droits que vous possédez ; votre rôle et le rôle Administrateur sont réservés au super administrateur."}
          </p>
        </div>
        <Button onClick={save} loading={pending} disabled={!dirty} data-testid="grants-save">Enregistrer la matrice</Button>
      </div>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Statut</th>
              {superRole && (
                <th scope="col" className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />{superRole.name}</span>
                </th>
              )}
              {columns.map((r) => (
                <th key={r.id} scope="col" className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1">{columnLocked(r) && <Lock className="size-3" aria-hidden />}{r.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.id} data-testid={`grants-row-${s.name}`}>
                <th scope="row" className="sticky left-0 z-10 border-t bg-card px-3 py-2 text-left font-medium">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                    <span className="max-w-40 truncate">{s.name}</span>
                    {s.is_initial && <Badge>Initial</Badge>}
                  </span>
                </th>
                {superRole && (
                  <td className="border-t px-3 py-2 text-center">
                    <Checkbox checked disabled aria-label={`${superRole.name} peut tout poser (${s.name})`} />
                  </td>
                )}
                {columns.map((r) => {
                  const c = get(s.id, r.id);
                  const m = mine(s.id);
                  const locked = columnLocked(r);
                  const placeOff = locked || (!isSuperAdmin && !m.place && !c.place);
                  const createOff = locked || !c.place || s.is_initial || (!isSuperAdmin && !m.create && !c.create);
                  return (
                    <td key={r.id} className="border-t px-3 py-2 text-center align-top">
                      <div className="flex flex-col items-center gap-1.5">
                        <label className="flex min-h-10 min-w-10 cursor-pointer items-center justify-center">
                          <Checkbox
                            checked={c.place}
                            disabled={placeOff}
                            onCheckedChange={(v) => set(s.id, r.id, { place: v === true })}
                            aria-label={`${r.name} peut poser ${s.name}`}
                            data-testid={`grant-${s.name}-${r.name}`}
                          />
                        </label>
                        {!s.is_initial && (
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Checkbox
                              className="size-4"
                              checked={c.create}
                              disabled={createOff}
                              onCheckedChange={(v) => set(s.id, r.id, { create: v === true })}
                              aria-label={`${r.name} peut créer un lead directement en ${s.name}`}
                            />
                            à la création
                          </label>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Rappel : un déplacement exige aussi une transition autorisée (panneau de chaque statut) ; cette matrice limite en plus les statuts de destination par rôle.
      </p>
    </Card>
  );
}
