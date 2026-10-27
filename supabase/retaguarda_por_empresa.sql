-- Retaguarda por empresa (Weevo e Carbone). Rodar uma vez no SQL Editor do Supabase.
-- acesso por empresa: lista de retaguardas que cada usuario pode abrir
alter table public.profiles add column if not exists orgs_acesso uuid[] not null default '{}';
update public.profiles set orgs_acesso = array[org_id] where orgs_acesso = '{}';
update public.profiles set orgs_acesso = (select array_agg(id order by criado_em) from public.organizacoes) where super_admin;

-- empresa que o usuario esta vendo: a escolhida no login, se ele tiver acesso a ela; senao a principal
create or replace function public.org_atual() returns uuid language sql stable security definer set search_path = public as $$
  select case when p.org_ativa is not null and (p.super_admin or p.org_ativa = any(p.orgs_acesso)) then p.org_ativa else p.org_id end
    from public.profiles p where p.id = auth.uid()
$$;
-- quem tem acesso a empresa aberta aparece na lista de usuarios dela
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (public.eh_gestor() and (org_id = public.org_atual() or public.org_atual() = any(orgs_acesso))) or public.eh_super());

-- configuracao: uma linha por empresa (Weevo continua id 1; o worker le id 1)
create or replace function public.org_padrao() returns uuid language sql stable set search_path = public as $$ select coalesce(public.org_atual(), public.org_weevo()) $$;
do $$ declare t text; begin
  foreach t in array array['analises_time','audit_settings','config_auditoria','criterios_rubrica','google_agenda','numeros_ignorados','resumos_turno','telefones_alerta'] loop
    execute format('alter table public.%I alter column org_id set default public.org_padrao()', t);
  end loop;
end $$;
alter table public.audit_settings drop constraint if exists audit_settings_id_check;
alter table public.config_auditoria drop constraint if exists config_auditoria_id_check;
alter table public.google_agenda drop constraint if exists google_agenda_id_check;
create unique index if not exists audit_settings_org_uk on public.audit_settings(org_id);
create unique index if not exists config_auditoria_org_uk on public.config_auditoria(org_id);
create unique index if not exists google_agenda_org_uk on public.google_agenda(org_id);

alter table public.criterios_rubrica drop constraint if exists criterios_rubrica_rubrica_chave_key;
alter table public.criterios_rubrica add constraint criterios_rubrica_org_rubrica_chave_key unique (org_id, rubrica, chave);
alter table public.telefones_alerta drop constraint telefones_alerta_pkey;
alter table public.telefones_alerta add primary key (org_id, telefone);
alter table public.numeros_ignorados drop constraint numeros_ignorados_pkey;
alter table public.numeros_ignorados add primary key (org_id, telefone);

-- Carbone comeca com a mesma configuracao e rubrica da Weevo (sem WhatsApp de envio, resumo desligado ate configurar)
insert into public.audit_settings select (jsonb_populate_record(null::public.audit_settings, to_jsonb(s) || jsonb_build_object('id', 2, 'org_id', o.id, 'instancia_envio_id', null, 'resumo_ativo', false, 'resumo_ultimo_envio', null, 'rodada_final_ultima', null, 'resumo_manha_ultima', null))).*
  from public.audit_settings s, public.organizacoes o where s.id = 1 and o.slug = 'carbone' on conflict do nothing;
insert into public.config_auditoria select (jsonb_populate_record(null::public.config_auditoria, to_jsonb(c) || jsonb_build_object('id', 2, 'org_id', o.id))).*
  from public.config_auditoria c, public.organizacoes o where c.id = 1 and o.slug = 'carbone' on conflict do nothing;
insert into public.criterios_rubrica (org_id, rubrica, chave, nome, descricao, peso, ativo, posicao)
  select o.id, c.rubrica, c.chave, c.nome, c.descricao, c.peso, c.ativo, c.posicao from public.criterios_rubrica c, public.organizacoes o
  where o.slug = 'carbone' and c.org_id = public.org_weevo() on conflict do nothing;

-- regras que contavam a tabela inteira passam a contar por empresa
create or replace function public.limite_telefones_alerta() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.telefones_alerta group by org_id having count(*) > 3) then raise exception 'No máximo 3 telefones de alerta'; end if;
  return null;
end $$;
create or replace function public.checar_pesos_rubrica() returns trigger language plpgsql set search_path = public as $$
declare r record;
begin
  for r in select org_id, rubrica, coalesce(sum(peso) filter (where ativo), 0) s from public.criterios_rubrica group by 1, 2 loop
    if r.s <> 100 then raise exception 'Os pesos da rubrica % somam % por cento; precisam somar 100', r.rubrica, r.s; end if;
  end loop;
  return null;
end $$;
create or replace function public.salvar_rubrica(p_rubrica text, p_criterios jsonb) returns void language plpgsql set search_path = public as $$
declare o uuid := public.org_atual();
begin
  if not public.eh_gestor() then raise exception 'Sem permissão'; end if;
  update public.criterios_rubrica set ativo = false
   where org_id = o and rubrica = p_rubrica and chave not in (select c->>'chave' from jsonb_array_elements(p_criterios) c);
  insert into public.criterios_rubrica (org_id, rubrica, chave, nome, descricao, peso, ativo, posicao)
  select o, p_rubrica, c->>'chave', c->>'nome', coalesce(c->>'descricao',''), (c->>'peso')::int, coalesce((c->>'ativo')::boolean, true), ord::int
    from jsonb_array_elements(p_criterios) with ordinality as t(c, ord)
  on conflict (org_id, rubrica, chave) do update set nome = excluded.nome, descricao = excluded.descricao, peso = excluded.peso, ativo = excluded.ativo, posicao = excluded.posicao;
end $$;
create or replace function public.status_agenda() returns table(conectada boolean, email text, conectado_em timestamptz, erro text)
  language sql stable security definer set search_path = public as $$
  select refresh_token is not null, email, conectado_em, erro from public.google_agenda where org_id = public.org_atual() and public.eh_gestor()
$$;
