"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPinned } from "lucide-react";
import { toast } from "sonner";
import { fixLocationAction } from "@/app/(app)/agenda/repartition/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Suggestion } from "@/lib/geo/resolve";
import { parseCoordinates } from "@/lib/geo/coords";
import { AddressField } from "./address-field";
import { GpsPasteField } from "./gps-paste-field";

const PinMap = dynamic(() => import("./pin-map"), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-lg bg-muted" /> });

export interface FixTarget {
  id: string;
  lead_name: string;
  address: string | null;
  reason: string;
  precision: string | null;
  lat: number | null;
  lng: number | null;
}

/** Correction en un clic d'un RDV « à vérifier » : autre adresse (autocomplétion), adresse manuelle, pin, coordonnées, ou acceptation de l'approximation. */
export function LocationFixDialog({ target }: { target: FixTarget }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(target.address ?? "");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [man, setMan] = useState({ address: target.address ?? "", postcode: "", city: "" });
  const [pin, setPin] = useState<{ lat: number; lng: number }>({ lat: target.lat ?? 45.764, lng: target.lng ?? 4.8357 });
  const [coords, setCoords] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const send = (payload: Record<string, unknown>, ok: string) => start(async () => {
    const r = await fixLocationAction({ id: target.id, ...payload });
    if (r.ok) { toast.success(ok); setOpen(false); setFe({}); router.refresh(); }
    else { setFe(r.fieldErrors ?? {}); toast.error(r.error); }
  });
  const gps = coords.trim() ? parseCoordinates(coords, target.lat !== null && target.lng !== null ? { lat: target.lat, lng: target.lng } : null) : null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="fix-open"><MapPinned className="size-3.5" /> Corriger</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Corriger la position — {target.lead_name}</DialogTitle>
            <DialogDescription>{target.reason} Votre correction est enregistrée et journalisée sur le lead.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="coords">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="coords">Position GPS (Google Maps)</TabsTrigger>
              <TabsTrigger value="search">Autre adresse</TabsTrigger>
              <TabsTrigger value="manual">Saisie manuelle</TabsTrigger>
              <TabsTrigger value="pin">Pin sur carte</TabsTrigger>
            </TabsList>
            <TabsContent value="search" className="space-y-3">
              <Label htmlFor={`fx-q-${target.id}`}>Rechercher l&apos;adresse</Label>
              <AddressField id={`fx-q-${target.id}`} value={q} onChange={(v) => { setQ(v); setPicked(null); }} onPick={setPicked} />
              {picked && <p className="text-xs text-muted-foreground" data-testid="fix-picked">Sélection : {picked.label} ({picked.precision === "municipality" ? "commune seule" : "point précis"})</p>}
              <Button className="w-full" disabled={!picked} loading={pending} data-testid="fix-save-search"
                onClick={() => picked && send({ mode: "suggestion", label: picked.label, lat: picked.lat, lng: picked.lng, precision: picked.precision, score: picked.score, insee: picked.insee }, "Position enregistrée.")}>Utiliser cette adresse</Button>
            </TabsContent>
            <TabsContent value="manual" className="space-y-3">
              <div className="space-y-2"><Label htmlFor={`fx-a-${target.id}`}>Adresse (texte libre)</Label>
                <Input id={`fx-a-${target.id}`} value={man.address} onChange={(e) => setMan({ ...man, address: e.target.value })} aria-invalid={fe.address ? true : undefined} /><FieldError id={`fx-a-e-${target.id}`} message={fe.address} /></div>
              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <div className="space-y-2"><Label htmlFor={`fx-p-${target.id}`}>Code postal</Label><Input id={`fx-p-${target.id}`} inputMode="numeric" maxLength={5} value={man.postcode} onChange={(e) => setMan({ ...man, postcode: e.target.value })} aria-invalid={fe.postcode ? true : undefined} /><FieldError id={`fx-p-e-${target.id}`} message={fe.postcode} /></div>
                <div className="space-y-2"><Label htmlFor={`fx-c-${target.id}`}>Commune</Label><Input id={`fx-c-${target.id}`} value={man.city} onChange={(e) => setMan({ ...man, city: e.target.value })} aria-invalid={fe.city ? true : undefined} /><FieldError id={`fx-c-e-${target.id}`} message={fe.city} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Recherche en chaîne : BAN, Nominatim, puis centre de la commune (position approximative, signalée par un badge).</p>
              <Button className="w-full" loading={pending} data-testid="fix-save-manual" onClick={() => send({ mode: "manual_address", ...man }, "Position enregistrée (voir le badge de précision).")}>Enregistrer</Button>
            </TabsContent>
            <TabsContent value="pin" className="space-y-3">
              <PinMap lat={pin.lat} lng={pin.lng} onMove={(lat, lng) => setPin({ lat, lng })} />
              <p className="text-xs text-muted-foreground">Position : {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</p>
              <Button className="w-full" loading={pending} onClick={() => send({ mode: "pin", ...pin }, "Pin enregistré.")}>Valider ce pin</Button>
            </TabsContent>
            <TabsContent value="coords" className="space-y-3">
              <GpsPasteField id={`fx-g-${target.id}`} value={coords} onChange={setCoords} address={target.address} near={{ lat: target.lat, lng: target.lng }} />
              <Button className="w-full" disabled={!gps?.ok} loading={pending} data-testid="fix-save-coords" onClick={() => send({ mode: "gps", text: coords }, "Position enregistrée.")}>Utiliser cette position</Button>
            </TabsContent>
          </Tabs>
          {target.precision === "municipality" && target.lat !== null && (
            <Button variant="ghost" className="w-full" loading={pending} data-testid="fix-accept" onClick={() => send({ mode: "accept" }, "Approximation acceptée : marge de durée majorée.")}>
              Accepter la position approximative (marge de +20 min)
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
