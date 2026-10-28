-- Support prioritaire (plan Premium) : les demandes envoyées par un abonné Premium connecté sont marquées `priority`
-- (calcul côté serveur uniquement, jamais depuis le formulaire) pour être traitées en premier.
alter table public.contact_requests
  add column priority boolean not null default false,
  add column org_id uuid references public.organizations(id) on delete set null;
create index contact_requests_priority_idx on public.contact_requests (priority desc, created_at desc);
