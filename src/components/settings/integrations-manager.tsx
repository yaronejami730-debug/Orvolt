"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { createEndpointAction, deleteEndpointAction, regenerateEndpointSecretAction, testEndpointAction, updateEndpointAction } from "@/app/(app)/settings/integrations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ago } from "@/components/leads/format";
import { explainMapping, GENERIC_TARGETS } from "@/lib/inbound/adapters";

export interface EndpointView {
  id: string;
  name: string;
  kind: "generic" | "meta" | "google";
  token: string;
  secret_prefix: string;
  secret_version: number | null;
  has_meta_secret: boolean;
  default_source_id: string | null;
  mapping: Record<string, string>;
  dedupe_window_hours: number;
  active: boolean;
}
export interface EventView { id: string; endpoint_id: string; received_at: string; status: "created" | "duplicate" | "rejected"; reason: string | null; payload: unknown }

const KIND_LABEL = { generic: "JSON générique", meta: "Meta Lead Ads", google: "Google Ads" } as const;
const STATUS_TONE = { created: "success", duplicate: "warning", rejected: "destructive" } as const;
const STATUS_LABEL = { created: "Créé", duplicate: "Doublon", rejected: "Rejeté" } as const;
const REASON: Record<string, string> = {
  unauthorized: "Authentification refusée", invalid_json: "JSON invalide", invalid_email: "E-mail invalide", invalid_phone: "Téléphone invalide",
  no_identity: "Aucun nom", no_contact: "Ni e-mail ni téléphone", duplicate_in_window: "Déjà reçu récemment", no_lead_in_payload: "Aucun lead dans le contenu",
  invalid_custom_field: "Champ personnalisé invalide", invalid_value: "Valeur invalide", storage_error: "Erreur d'enregistrement", no_initial_status: "Aucun statut initial",
};

const mappingToText = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k} -> ${v}`).join("\n");
function textToMapping(t: string): { mapping: Record<string, string>; error?: string } {
  const out: Record<string, string> = {};
  for (const [i, raw] of t.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [k, v, ...rest] = line.split("->").map((x) => x.trim());
    if (!k || !v || rest.length) return { mapping: out, error: `Ligne ${i + 1} invalide : attendu « chemin.json -> champ » (ex. contact.email -> email).` };
    out[k] = v;
  }
  return { mapping: out, error: explainMapping(out) ?? undefined };
}

export function IntegrationsManager({ endpoints, events, sources, baseUrl }: { endpoints: EndpointView[]; events: EventView[]; sources: { id: string; name: string }[]; baseUrl: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; secret: string; url: string } | null>(null);
  const [pending, start] = useTransition();
  const urlOf = (e: EndpointView) => `${baseUrl}/api/webhooks/inbound/${e.token}`;
  const copy = (t: string, what: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${what} copié.`), () => toast.error("Copie impossible."));

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="size-4" /> Créer un webhook</Button></div>
      {endpoints.length === 0 ? (
        <EmptyState icon={Webhook} title="Aucun webhook entrant" description="Recevez automatiquement les leads de Meta Lead Ads, Google Ads ou de tout outil capable d'envoyer du JSON."
          action={<Button onClick={() => setCreating(true)}>Créer un webhook</Button>} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {endpoints.map((e) => (
            <EndpointCard key={e.id} e={e} sources={sources} url={urlOf(e)} events={events.filter((x) => x.endpoint_id === e.id).slice(0, 8)} pending={pending}
              onCopy={copy}
              onSaved={() => router.refresh()}
              onSecret={(s) => setSecret({ name: e.name, secret: s, url: urlOf(e) })}
              start={start} />
          ))}
        </div>
      )}
      <CreateDialog open={creating} onOpenChange={setCreating} sources={sources} baseUrl={baseUrl} onCreated={(name, s, token) => { setCreating(false); setSecret({ name, secret: s, url: `${baseUrl}/api/webhooks/inbound/${token}` }); router.refresh(); }} />
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Secret du webhook « {secret?.name} »</DialogTitle>
            <DialogDescription>Copiez-le maintenant : il ne sera plus jamais affiché (seul son hachage est conservé).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <code data-testid="new-secret" className="block break-all rounded-md bg-muted px-3 py-2 text-xs">{secret?.secret}</code>
            <Button variant="outline" size="sm" onClick={() => copy(secret!.secret, "Secret")}><Copy className="size-3.5" /> Copier le secret</Button>
            <p className="text-muted-foreground">URL : <code className="break-all text-xs" data-testid="new-url">{secret?.url}</code></p>
            <p className="text-xs text-muted-foreground">Envoyez-le dans l&apos;en-tête <code>X-LeadForge-Secret</code>, ou signez le corps (<code>X-LeadForge-Signature: t=&lt;horodatage&gt;,v1=&lt;HMAC-SHA256 de « horodatage.corps »&gt;</code>, clé = le secret ; une signature reste rejouable 5 minutes). Meta : utilisez-le comme « verify token ». Google : champ <code>google_key</code>.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EndpointCard({ e, sources, url, events, pending, onCopy, onSaved, onSecret, start }: {
  e: EndpointView; sources: { id: string; name: string }[]; url: string; events: EventView[]; pending: boolean;
  onCopy: (t: string, w: string) => void; onSaved: () => void; onSecret: (s: string) => void; start: (fn: () => Promise<void>) => void;
}) {
  const [map, setMap] = useState(mappingToText(e.mapping));
  const [source, setSource] = useState(e.default_source_id ?? "");
  const [err, setErr] = useState<string>();
  const [metaSecret, setMetaSecret] = useState("");
  const save = (patch: Partial<{ active: boolean }> = {}) => {
    const parsed = textToMapping(map);
    if (parsed.error) { setErr(parsed.error); return; }
    start(async () => {
      const r = await updateEndpointAction({ id: e.id, name: e.name, defaultSourceId: source || null, mapping: parsed.mapping, dedupeWindowHours: e.dedupe_window_hours, active: patch.active ?? e.active, ...(e.kind === "meta" && metaSecret ? { metaAppSecret: metaSecret } : {}) });
      if (r.ok) { toast.success("Webhook enregistré."); setErr(undefined); setMetaSecret(""); onSaved(); } else setErr(r.error);
    });
  };
  return (
    <Card className="min-w-0 space-y-4 overflow-hidden p-5" data-testid={`endpoint-${e.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words font-semibold">{e.name}</h3>
        <Badge tone="accent">{KIND_LABEL[e.kind]}</Badge>
        <span className="ml-auto flex items-center gap-2 text-sm">Actif <Switch aria-label={`Activer ${e.name}`} checked={e.active} disabled={pending} onCheckedChange={(v) => save({ active: v })} /></span>
      </div>
      <div className="space-y-1">
        <Label>URL</Label>
        <div className="flex min-w-0 gap-2"><code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs" data-testid="endpoint-url">{url}</code>
          <Button size="icon" variant="outline" aria-label="Copier l'URL" onClick={() => onCopy(url, "URL")}><Copy className="size-4" /></Button></div>
        <p className="text-xs text-muted-foreground">Secret : <code>{e.secret_prefix}…</code> (masqué){e.secret_version === null && " · ancien secret : régénérez-le pour activer la signature HMAC"}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`src-${e.id}`}>Source par défaut</Label>
        <Select id={`src-${e.id}`} value={source} onChange={(ev) => setSource(ev.target.value)}>
          <option value="">Aucune</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      {e.kind === "meta" && (
        <div className="space-y-2">
          <Label htmlFor={`meta-${e.id}`}>Secret d&apos;application Meta {e.has_meta_secret && <Badge tone="success">Configuré</Badge>}</Label>
          <Input id={`meta-${e.id}`} type="password" autoComplete="off" value={metaSecret} onChange={(ev) => setMetaSecret(ev.target.value)} placeholder={e.has_meta_secret ? "•••••••• (laisser vide pour conserver)" : "Optionnel, recommandé"} />
          <p className="text-xs text-muted-foreground">Une fois renseigné, la signature <code>X-Hub-Signature-256</code> de Meta devient obligatoire. Le secret est chiffré et n&apos;est jamais ré-affiché.</p>
        </div>
      )}
      {e.kind === "generic" && (
        <div className="space-y-2">
          <Label htmlFor={`map-${e.id}`}>Mappage JSON → champ du lead (une règle par ligne)</Label>
          <Textarea id={`map-${e.id}`} value={map} onChange={(ev) => setMap(ev.target.value)} rows={4} placeholder={"contact.email -> email\ncontact.name -> fullName"} />
          <p className="text-xs text-muted-foreground">Champs : {GENERIC_TARGETS.join(", ")}, custom.&lt;clé&gt;. Vide = noms usuels (email, phone, first_name, name…).</p>
        </div>
      )}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save()} loading={pending}>Enregistrer</Button>
        <Button size="sm" variant="outline" onClick={() => start(async () => { const r = await testEndpointAction({ id: e.id }); if (r.ok) { toast.success(`Test envoyé : ${r.data?.result}.`); onSaved(); } else toast.error(r.error); })}><Send className="size-3.5" /> Envoyer un test</Button>
        <Button size="sm" variant="outline" onClick={() => { if (window.confirm("Régénérer le secret ? L'ancien cessera de fonctionner.")) start(async () => { const r = await regenerateEndpointSecretAction({ id: e.id }); if (r.ok && r.data) { onSecret(r.data.secret); onSaved(); } else toast.error(r.error); }); }}><RefreshCw className="size-3.5" /> Régénérer le secret</Button>
        <Button size="sm" variant="ghost" aria-label={`Supprimer ${e.name}`} onClick={() => { if (window.confirm(`Supprimer le webhook « ${e.name} » et son journal ?`)) start(async () => { const r = await deleteEndpointAction({ id: e.id }); if (r.ok) { toast.success("Webhook supprimé."); onSaved(); } else toast.error(r.error); }); }}><Trash2 className="size-3.5" /></Button>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">Journal récent</h4>
        {events.length === 0 ? <p className="text-sm text-muted-foreground">Aucun événement.</p> : (
          <ul className="space-y-1.5" data-testid="event-log">
            {events.map((ev) => (
              <li key={ev.id} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <Badge tone={STATUS_TONE[ev.status]}>{STATUS_LABEL[ev.status]}</Badge>
                <span className="text-muted-foreground">{ago(ev.received_at)}</span>
                {ev.reason && <span>{REASON[ev.reason] ?? ev.reason}</span>}
                {ev.payload ? <code className="block w-full min-w-0 truncate text-muted-foreground" title="Données masquées">{JSON.stringify(ev.payload).slice(0, 80)}</code> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CreateDialog({ open, onOpenChange, sources, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; sources: { id: string; name: string }[]; baseUrl: string; onCreated: (name: string, secret: string, token: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"generic" | "meta" | "google">("generic");
  const [source, setSource] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Créer un webhook entrant</DialogTitle><DialogDescription>Une URL unique et un secret vous seront attribués.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => {
          const r = await createEndpointAction({ name, kind, defaultSourceId: source || null });
          if (r.ok && r.data) { setName(""); setFe({}); onCreated(name, r.data.secret, r.data.token); } else { setFe(r.fieldErrors ?? {}); if (!r.fieldErrors) toast.error(r.error); }
        }); }}>
          <div className="space-y-2"><Label htmlFor="wh-name">Nom</Label><Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fe.name ? true : undefined} /><FieldError id="wh-name-error" message={fe.name} /></div>
          <div className="space-y-2"><Label htmlFor="wh-kind">Type</Label>
            <Select id="wh-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="generic">JSON générique</option><option value="meta">Meta Lead Ads</option><option value="google">Google Ads</option></Select></div>
          <div className="space-y-2"><Label htmlFor="wh-source">Source par défaut</Label>
            <Select id="wh-source" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Aucune</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
          <Button type="submit" className="w-full" loading={pending}>Créer le webhook</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
