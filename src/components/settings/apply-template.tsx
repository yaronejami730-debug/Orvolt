"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { applyTemplateAction } from "@/app/(app)/settings/template-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AVAILABLE_TEMPLATES, TEMPLATES } from "@/lib/templates";

/** Réinitialise statuts, champs et sources avec un template (refusé si des leads existent). */
export function ApplyTemplateButton({ current, label = "Appliquer un template", variant = "outline" }: { current: string; label?: string; variant?: "outline" | "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState(current);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><Sparkles className="size-4" /> {label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Appliquer un template métier</DialogTitle>
            <DialogDescription>
              Vos statuts, champs personnalisés et sources actuels seront remplacés. Impossible si des leads existent déjà.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tpl-select">Template</Label>
            <Select id="tpl-select" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {TEMPLATES.filter((t) => t.id === current || AVAILABLE_TEMPLATES.some((a) => a.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await applyTemplateAction({ template });
                  if (res.ok) { toast.success("Template appliqué."); setOpen(false); setError(undefined); router.refresh(); }
                  else setError(res.error);
                })
              }
            >
              Remplacer ma configuration
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
