-- Le téléprospecteur saisit des leads mais ne les importe pas : l'import (fichier CSV) reste un acte d'administration.
-- 1) Rôles système « Prospecteur » existants : retrait de leads.import.
-- 2) Trigger sur public.roles : les fonctions de création d'organisation (create_organization*, create_partner_organization)
--    insèrent encore leads.import pour ce rôle ; on le retire à l'insertion sans réécrire ces fonctions.
-- Un administrateur peut toujours réaccorder le droit depuis Paramètres > Rôles (le trigger ne touche que l'insertion initiale).

update public.roles
set permissions = array_remove(permissions, 'leads.import'),
    description = 'Saisit des leads, gère ses rendez-vous'
where is_system and name = 'Prospecteur';

create or replace function public.roles_prospecteur_defaults() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_system and new.name = 'Prospecteur' then
    new.permissions := array_remove(new.permissions, 'leads.import');
    if new.description = 'Saisit et importe des leads, gère ses rendez-vous' then
      new.description := 'Saisit des leads, gère ses rendez-vous';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists roles_prospecteur_defaults on public.roles;
create trigger roles_prospecteur_defaults
  before insert on public.roles
  for each row execute function public.roles_prospecteur_defaults();
