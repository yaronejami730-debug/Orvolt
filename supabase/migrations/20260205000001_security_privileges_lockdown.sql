-- Second audit sécurité : défense en profondeur sur les droits d'exécution et de table.
-- Le rôle `anon` (clé publique, sans connexion) n'a besoin d'AUCUNE fonction ni table du schéma public : toute l'application
-- passe par `authenticated` (RLS) ou `service_role` (serveur). On retire donc tout à `anon` et à PUBLIC, puis on ré-accorde
-- exactement ce dont `authenticated` / `service_role` disposaient (état courant), pour ne rien casser.
-- Idempotent : rejouable sans effet.

do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
      has_function_privilege('service_role', p.oid, 'execute') as svc_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- fonctions d'extensions : intactes
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.svc_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;

-- Tables, vues et séquences : rien pour anon.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Futurs objets : pas de droits automatiques pour anon (sans effet si le rôle n'existe pas / privilèges non accordés).
do $$
begin
  alter default privileges for role postgres in schema public revoke all on functions from anon;
  alter default privileges for role postgres in schema public revoke all on tables from anon;
  alter default privileges for role postgres in schema public revoke all on sequences from anon;
exception when others then
  null;
end $$;
