-- Painel do Closer: leads vindos da planilha e o progresso de cada um. Rodar uma vez no SQL Editor do Supabase.
-- "dados" e substituido a cada atualizacao da planilha; as colunas de progresso nunca sao apagadas por ela.
create table if not exists public.closer_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.org_padrao() references public.organizacoes(id),
  chave text not null,
  dados jsonb not null,
  status text check (status in ('novo','mensagem','respondeu','negociando','fechou_plataforma','fechou_imersao','sem_resposta','desqualificado')),
  enviadas int not null default 0 check (enviadas between 0 and 3),
  motivo text not null default '',
  anotacao text not null default '',
  status_em timestamptz,
  atualizado_por uuid references public.profiles(id),
  importado_em timestamptz not null default now(),
  unique (org_id, chave)
);
alter table public.closer_leads enable row level security;

-- Quem usa o painel: gestor, admin e quem tem a funcao Closer
create or replace function public.pode_closer() returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestor() or coalesce((select funcao = 'closer' from public.profiles where id = auth.uid()), false)
$$;
revoke all on function public.pode_closer() from public, anon;
grant execute on function public.pode_closer() to authenticated;

drop policy if exists closer_select on public.closer_leads;
create policy closer_select on public.closer_leads for select to authenticated using (public.pode_closer() and org_id = public.org_atual());
drop policy if exists closer_update on public.closer_leads;
create policy closer_update on public.closer_leads for update to authenticated using (public.pode_closer() and org_id = public.org_atual()) with check (public.pode_closer() and org_id = public.org_atual());

-- Pelo site so o progresso muda; inserir e atualizar os dados da planilha e feito pelo servidor, depois de conferir o gestor
revoke all on public.closer_leads from anon, authenticated;
grant select on public.closer_leads to authenticated;
grant update (status, enviadas, motivo, anotacao, status_em, atualizado_por) on public.closer_leads to authenticated;
