"use client";

import { ExternalLink } from "lucide-react";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { googleMapsSearchUrl, parseCoordinates } from "@/lib/geo/coords";

/**
 * « Position GPS (depuis Google Maps) » : le télépro, le commercial ou le confirmateur colle l'endroit exact quand l'adresse
 * est introuvable ou approximative. Format tolérant (voir parseCoordinates) ; avertit si la position est loin du point connu.
 */
export function GpsPasteField({ id, value, onChange, address, near }: {
  id: string; value: string; onChange: (v: string) => void; address?: string | null; near?: { lat: number | null; lng: number | null };
}) {
  const parsed = value.trim() ? parseCoordinates(value, near && near.lat !== null && near.lng !== null ? { lat: near.lat, lng: near.lng } : null) : null;
  return (
    <div className="space-y-2" data-testid="gps-field">
      <Label htmlFor={id}>Position GPS (depuis Google Maps)</Label>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>Ouvrez Google Maps et trouvez le lieu <a href={googleMapsSearchUrl(address ?? "")} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-link underline-offset-2 hover:underline" data-testid="open-gmaps">Ouvrir Google Maps<ExternalLink className="size-3" /></a></li>
        <li>Faites un clic droit (appui long sur mobile) sur le lieu exact</li>
        <li>Copiez les coordonnées affichées (ex. 43.9493, 5.7826) et collez-les ici</li>
      </ol>
      <Input id={id} value={value} inputMode="text" autoComplete="off" placeholder="43.9493, 5.7826 ou lien Google Maps complet" onChange={(e) => onChange(e.target.value)} aria-invalid={parsed && !parsed.ok ? true : undefined} data-testid="fix-coords" />
      {parsed && !parsed.ok && <FieldError id={`${id}-err`} message={parsed.error} />}
      {parsed?.ok && <p className="text-xs text-success-text" data-testid="gps-ok">Position lue : {parsed.lat}, {parsed.lng}</p>}
      {parsed?.ok && parsed.warnings.map((w) => <p key={w} className="text-xs text-warning-text" data-testid="gps-warning">{w}</p>)}
    </div>
  );
}
