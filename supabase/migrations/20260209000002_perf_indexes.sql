-- Index de performance (idempotent). NON testé sous charge au moment de l'écriture : à rejouer sur une base volumineuse.
-- Sur une très grosse table en production, préférer créer ces index à la main avec CREATE INDEX CONCURRENTLY.

-- leads : tri par nom (les deux sens), colonne Kanban, lecture « mes leads » (created_by) + FK created_by, recherche par téléphone normalisé.
create index if not exists leads_org_lastname_idx on public.leads (org_id, last_name, id);
create index if not exists leads_org_position_idx on public.leads (org_id, position);
create index if not exists leads_created_by_idx on public.leads (created_by, org_id) where created_by is not null;
create index if not exists leads_phone_norm_trgm_idx on public.leads using gin (phone_norm extensions.gin_trgm_ops) where phone_norm is not null;
-- Doublon strict de leads_org_assigned_created_idx (org_id, assigned_to, created_at) : la FK (org_id, assigned_to) reste couverte.
drop index if exists public.leads_org_assigned_idx;

-- appointments : agenda / dashboard / « prochain RDV » filtrent par org + plage de dates sans assigné ; FK utilisateurs.
create index if not exists appointments_org_starts_idx on public.appointments (org_id, starts_at);
create index if not exists appointments_created_by_idx on public.appointments (created_by) where created_by is not null;
create index if not exists appointments_confirmer_fk_idx on public.appointments (confirmer_id) where confirmer_id is not null;
create index if not exists appointments_geo_fixed_by_idx on public.appointments (geo_fixed_by) where geo_fixed_by is not null;
create index if not exists appointments_issue_by_idx on public.appointments (issue_by) where issue_by is not null;
create index if not exists appointments_locked_by_idx on public.appointments (locked_by) where locked_by is not null;
create index if not exists appointments_override_by_idx on public.appointments (override_by) where override_by is not null;

-- lead_events : dernier « assigned » d'une équipe (répartition d'import) sans parcourir tout le journal.
create index if not exists lead_events_assigned_idx on public.lead_events (org_id, created_at desc) where type = 'assigned';

-- notifications : liste (20 dernières) et compteur de non lues par utilisateur ; FK org.
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_org_idx on public.notifications (org_id);
drop index if exists public.notifications_user_idx; -- remplacé par les deux index ci-dessus

-- tasks / notes / appels / fichiers : FK sans index (suppression d'un lead ou d'un utilisateur = parcours complet).
create index if not exists tasks_lead_idx on public.tasks (lead_id) where lead_id is not null;
create index if not exists tasks_created_by_idx on public.tasks (created_by) where created_by is not null;
create index if not exists tasks_org_idx on public.tasks (org_id);
create index if not exists lead_notes_author_idx on public.lead_notes (author_id) where author_id is not null;
create index if not exists lead_calls_caller_idx on public.lead_calls (caller_id) where caller_id is not null;
create index if not exists lead_files_uploaded_by_idx on public.lead_files (uploaded_by) where uploaded_by is not null;

-- Journaux à rétention : purge par date sans parcours complet (BRIN = quasi gratuit à l'écriture, données chronologiques).
create index if not exists inbound_events_lead_idx on public.inbound_events (lead_id) where lead_id is not null;
create index if not exists inbound_events_received_brin on public.inbound_events using brin (received_at);
create index if not exists inbound_events_unmasked_idx on public.inbound_events (received_at) where payload is not null;
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);
create index if not exists stripe_events_received_brin on public.stripe_events using brin (received_at);
create index if not exists email_verifications_expires_idx on public.email_verifications (expires_at);

-- FK restantes (tables de configuration ou petites, mais suppression d'organisation/utilisateur = cascade).
create index if not exists import_jobs_user_idx on public.import_jobs (user_id);
create index if not exists organizations_parent_idx on public.organizations (parent_org_id) where parent_org_id is not null;
create index if not exists organizations_created_by_idx on public.organizations (created_by) where created_by is not null;
create index if not exists inbound_endpoints_org_idx on public.inbound_endpoints (org_id);
create index if not exists inbound_endpoints_created_by_idx on public.inbound_endpoints (created_by) where created_by is not null;
create index if not exists inbound_endpoints_source_idx on public.inbound_endpoints (default_source_id) where default_source_id is not null;
create index if not exists call_script_questions_script_idx on public.call_script_questions (org_id, script_id);
create index if not exists call_script_runs_lead_idx on public.call_script_runs (lead_id);
create index if not exists call_script_runs_org_idx on public.call_script_runs (org_id);
create index if not exists call_script_runs_script_idx on public.call_script_runs (script_id);
create index if not exists call_script_runs_user_idx on public.call_script_runs (user_id);
create index if not exists contact_requests_org_idx on public.contact_requests (org_id) where org_id is not null;
create index if not exists sales_unavailability_created_by_idx on public.sales_unavailability (created_by) where created_by is not null;
create index if not exists status_actions_status_idx on public.status_actions (org_id, status_id);
create index if not exists status_role_grants_role_idx on public.status_role_grants (org_id, role_id);
create index if not exists status_role_grants_status_idx on public.status_role_grants (org_id, status_id);
create index if not exists status_transitions_from_idx on public.status_transitions (from_status_id);
create index if not exists status_transitions_to_idx on public.status_transitions (org_id, to_status_id);
create index if not exists status_transitions_role_idx on public.status_transitions (org_id, role_id);
