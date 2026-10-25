"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { regenerateSecretAction } from "@/app/(app)/settings/webhooks/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function WebhookSecret({ secret, version }: { secret: string; version: number }) {
  const router = useRouter();
  const [shown, setShown] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Secret de signature</h2>
        <p className="text-sm text-muted-foreground">
          Chaque webhook sortant porte l&apos;en-tête <code>X-LeadForge-Signature: t=&lt;horodatage&gt;,v1=&lt;HMAC-SHA256&gt;</code>, calculé sur <code>horodatage.corps</code> avec ce secret.
          Vérifiez-le côté récepteur et rejetez les horodatages de plus de 5 minutes.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code data-testid="webhook-secret" className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">{shown ? secret : "•".repeat(32)}</code>
        <Button variant="outline" size="icon" aria-label={shown ? "Masquer le secret" : "Afficher le secret"} onClick={() => setShown((s) => !s)}>{shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
        <Button variant="outline" size="icon" aria-label="Copier le secret" onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success("Secret copié."), () => toast.error("Copie impossible."))}><Copy className="size-4" /></Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Version {version}</span>
        <Button variant="destructive" size="sm" loading={pending} onClick={() => {
          if (!window.confirm("Régénérer le secret ? L'ancien ne sera plus valide : mettez à jour vos récepteurs.")) return;
          start(async () => { const r = await regenerateSecretAction(); if (r.ok) { toast.success("Secret régénéré."); router.refresh(); } else toast.error(r.error); });
        }}><RefreshCw className="size-3.5" /> Régénérer</Button>
      </div>
    </Card>
  );
}
