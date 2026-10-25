"use client";

import { useState, useTransition } from "react";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import { reportAddressFixAction, reportIssueAction } from "@/app/(app)/agenda/repartition/actions";
import { GpsPasteField } from "@/components/dispatch/gps-paste-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Le commercial signale un problème (adresse introuvable, imprévu…) : le confirmateur est notifié, la répartition ne change pas toute seule. */
export function ReportIssue({ id, label, address }: { id: string; label: string; address?: string | null }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [gps, setGps] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="issue-open"><MessageSquareWarning className="size-3.5" /> Signaler un problème</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Signaler un problème d&apos;adresse ou autre — {label}</DialogTitle>
            <DialogDescription>Le confirmateur reçoit votre message et décide de la suite. Votre agenda n&apos;est pas modifié automatiquement.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              // Avec une position GPS : le lead est corrigé et le RDV marqué « à rééquilibrer » ; sinon simple message au confirmateur.
              const r = gps.trim() ? await reportAddressFixAction({ id, text: gps, message: msg || undefined }) : await reportIssueAction({ id, message: msg });
              if (r.ok) { toast.success(gps.trim() ? "Position transmise : le confirmateur va rééquilibrer." : "Le confirmateur a été prévenu."); setOpen(false); setMsg(""); setGps(""); setErr(undefined); }
              else { setErr(r.fieldErrors?.message ?? r.fieldErrors?.text ?? r.error); }
            });
          }}>
            <Label htmlFor={`issue-${id}`}>Votre message</Label>
            <Textarea id={`issue-${id}`} value={msg} maxLength={500} rows={4} onChange={(e) => { setMsg(e.target.value); setErr(undefined); }} aria-invalid={err ? true : undefined} placeholder="Ex. l'adresse n'existe pas, client injoignable, accès impossible…" />
            <GpsPasteField id={`issue-gps-${id}`} value={gps} onChange={(v) => { setGps(v); setErr(undefined); }} address={address} />
            <FieldError id={`issue-err-${id}`} message={err} />
            <Button type="submit" className="w-full" loading={pending} data-testid="issue-send">Envoyer au confirmateur</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
