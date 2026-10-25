import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FIELD_TYPE_META, type FieldType } from "@/components/settings/field-types";
import { ApplyTemplateButton } from "@/components/settings/apply-template";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireSession, sessionCan } from "@/lib/session";
import { getTemplate } from "@/lib/templates";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function OnboardingPage() {
  const s = await requireSession();
  const supabase = await createClient();
  const [st, fi, so] = await Promise.all([
    supabase.from("statuses").select("id, name, color, kind").eq("org_id", s.org.id).order("position"),
    supabase.from("custom_fields").select("id, label, type, required").eq("org_id", s.org.id).order("position"),
    supabase.from("lead_sources").select("id, name, is_system").eq("org_id", s.org.id).eq("archived", false).order("created_at"),
  ]);
  const tpl = getTemplate(s.org.template);
  const statuses = st.data ?? [];
  const fields = (fi.data ?? []) as { id: string; label: string; type: FieldType; required: boolean }[];
  const sources = (so.data ?? []).filter((x) => !x.is_system);
  const canApply = sessionCan(s, "settings.manage") && sessionCan(s, "statuses.manage") && sessionCan(s, "fields.manage");
  const failed = statuses.length === 0;
  const link = (href: string, show: boolean) => show && <Link href={href} className="text-sm text-link hover:underline">Personnaliser</Link>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {failed ? "Votre espace est créé" : `Votre espace ${tpl?.label ?? ""} est prêt`}
        </h1>
        <p className="text-muted-foreground">
          {failed ? "Le template métier n'a pas pu être appliqué. Vous pouvez réessayer ou continuer avec un espace vierge." : tpl?.summary}
        </p>
      </div>
      {failed && canApply && <ApplyTemplateButton current={s.org.template} label="Réessayer l'application du template" variant="primary" />}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Statuts</CardTitle>
          {link("/settings/statuses", sessionCan(s, "statuses.manage"))}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2" data-testid="onboarding-statuses">
          {statuses.length === 0 && <p className="text-sm text-muted-foreground">Aucun statut pour le moment.</p>}
          {statuses.map((x) => (
            <Badge key={x.id} color={x.color} dot>{x.name}{x.kind === "won" ? " ✓" : x.kind === "lost" ? " ✗" : ""}</Badge>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Champs personnalisés</CardTitle>
          {link("/settings/fields", sessionCan(s, "fields.manage"))}
        </CardHeader>
        <CardContent data-testid="onboarding-fields">
          {fields.length === 0 ? <p className="text-sm text-muted-foreground">Aucun champ pour ce métier.</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {fields.map((f) => {
                const Icon = FIELD_TYPE_META[f.type].icon;
                return (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <Icon className="size-4 text-muted-foreground" aria-hidden /> {f.label}
                    {f.required && <Badge tone="accent">Obligatoire</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Sources de leads</CardTitle>
          {link("/settings/sources", sessionCan(s, "settings.manage"))}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2" data-testid="onboarding-sources">
          {sources.length === 0 && <p className="text-sm text-muted-foreground">Aucune source.</p>}
          {sources.map((x) => <Badge key={x.id}>{x.name}</Badge>)}
        </CardContent>
      </Card>
      <div className="fixed inset-x-0 bottom-16 z-20 flex flex-wrap items-center justify-center gap-3 border-t bg-background/90 p-4 backdrop-blur lg:static lg:bottom-auto lg:justify-start lg:border-0 lg:bg-transparent lg:p-0">
        <Button asChild size="lg"><Link href="/leads">Commencer <ArrowRight className="size-4" /></Link></Button>
        {canApply && !failed && <ApplyTemplateButton current={s.org.template} label="Changer de template" />}
      </div>
    </div>
  );
}
