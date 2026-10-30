-- Configuracoes > Mensagens: textos editaveis por empresa (aplicado em 30/10/2026)
create table if not exists public.modelos_mensagem (
  org_id uuid not null default public.org_padrao() references public.organizacoes(id),
  chave text not null,
  texto text,              -- null = usa o texto padrao do sistema
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (org_id, chave)
);
alter table public.modelos_mensagem enable row level security;
drop policy if exists mm_gestor on public.modelos_mensagem;
create policy mm_gestor on public.modelos_mensagem for all to authenticated
  using ((select public.eh_gestor()) and org_id = (select public.org_atual()))
  with check ((select public.eh_gestor()) and org_id = (select public.org_atual()));

-- Ligacoes feitas pelo CRM Q5 entram em ligacoes (origem crm). O Q5 nao expoe a gravacao: entram direcao, resultado e duracao.
alter table public.ligacoes drop constraint if exists ligacoes_origem_check;
alter table public.ligacoes add constraint ligacoes_origem_check check (origem = any (array['manual','whatsapp','crm']));
create unique index if not exists ux_lig_crm on public.ligacoes (wa_call_id) where origem = 'crm';
create or replace function public.ligacao_do_crm() returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text := coalesce(new.texto, '');
  dur int; tel text; res text;
begin
  if new.tipo <> 'call' or new.vendedor_id is null then return new; end if;
  dur := coalesce((regexp_match(t, '(\d+)h'))[1]::int, 0) * 3600 + coalesce((regexp_match(t, '(\d+)m'))[1]::int, 0) * 60 + coalesce((regexp_match(t, '(\d+)s\)'))[1]::int, 0);
  res := case when t ilike '%perdida%' then 'perdida' when t ilike '%não atendida%' then 'nao_atendida' when t ilike '%atendida%' then 'atendida'
              when t ilike '%recusada%' then 'recusada' when t ilike '%cancelada%' then 'cancelada' when t ilike '%falhou%' then 'falhou' else 'outra' end;
  select telefone into tel from crm_conversas where id = new.conversa_id;
  insert into ligacoes (vendedor_id, contato, duracao_seg, origem, iniciada_em, direcao, atendida, resultado, wa_call_id, org_id)
  values (new.vendedor_id, coalesce(regexp_replace(tel, '\D', '', 'g'), 'desconhecido'), nullif(dur, 0), 'crm', new.enviada_em,
          case when t ilike 'Chamada recebida%' or t ilike 'Chamada perdida%' then 'entrada' else 'saida' end,
          res = 'atendida', res, 'crm:' || new.id, new.org_id)
  on conflict (wa_call_id) where origem = 'crm' do update set duracao_seg = excluded.duracao_seg, atendida = excluded.atendida, resultado = excluded.resultado, vendedor_id = excluded.vendedor_id;
  return new;
end $$;
drop trigger if exists tg_ligacao_do_crm on public.crm_mensagens;
create trigger tg_ligacao_do_crm after insert or update of texto, vendedor_id on public.crm_mensagens for each row execute function public.ligacao_do_crm();
