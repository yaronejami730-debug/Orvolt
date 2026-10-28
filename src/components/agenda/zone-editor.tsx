"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { saveZoneAction } from "@/app/(app)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface ZoneView {
  base_address: string;
  radius_km: number;
  active: boolean;
}

export function ZoneEditor({ userId, name, zone, label }: { userId: string; name: string; zone: ZoneView | null; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(zone?.base_address ?? "");
  const [radius, setRadius] = useState(zone?.radius_km ?? 30);
  const [active, setActive] = useState(zone?.active ?? true);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={label ? `${label} (zone de ${name})` : `Zone de ${name}`}><MapPin className="size-3.5" /> {label ?? "Zone"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zone d&apos;intervention de {name}</DialogTitle>
            <DialogDescription>Adresse de départ et rayon maximal : les rendez-vous hors zone déclenchent une alerte.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveZoneAction({ userId, baseAddress: address, radiusKm: radius, active });
              if (r.ok) { toast.success("Zone enregistrée."); setOpen(false); setFe({}); router.refresh(); }
              else { setFe(r.fieldErrors ?? {}); if (!r.fieldErrors) toast.error(r.error); }
            });
          }}>
            <div className="space-y-2">
              <Label htmlFor="zone-address">Adresse de départ</Label>
              <Input id="zone-address" value={address} onChange={(e) => { setAddress(e.target.value); setFe({}); }} aria-invalid={fe.baseAddress ? true : undefined} placeholder="10 rue de Rivoli, 75004 Paris" />
              <FieldError id="zone-address-error" message={fe.baseAddress} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zone-radius">Rayon (km)</Label>
              <div className="flex items-center gap-3">
                <input aria-label="Rayon (curseur)" type="range" min={5} max={200} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                <Input id="zone-radius" type="number" min={5} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-24" aria-invalid={fe.radiusKm ? true : undefined} />
              </div>
              <FieldError id="zone-radius-error" message={fe.radiusKm} />
            </div>
            <label className="flex items-center justify-between text-sm font-medium">Zone active <Switch checked={active} onCheckedChange={setActive} aria-label="Zone active" /></label>
            <Button type="submit" className="w-full" loading={pending}>Enregistrer la zone</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
