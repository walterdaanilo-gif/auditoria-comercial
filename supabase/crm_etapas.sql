-- Historico de etapas do funil do CRM Q5 (cartao mudou de coluna). O crm_conversas so guarda a etapa ATUAL;
-- este trigger grava cada entrada numa etapa, para contar no periodo (ex.: closer: reunioes realizadas = entrou em
-- "Diagnostico realizado", propostas enviadas = entrou em "Proposta enviada", funil Vendas 2).
-- Comeca a contar quando foi aplicado (12/11/2026): nao ha historico de antes (a API so da a etapa atual).
create table if not exists public.crm_etapas (
  id          bigserial primary key,
  org_id      uuid references public.organizacoes(id),
  conversa_id uuid not null references public.crm_conversas(id) on delete cascade,
  vendedor_id uuid references public.profiles(id) on delete set null,
  etapa       text not null,
  anterior    text,
  em          timestamptz not null default now()
);
create index if not exists ix_crm_etapas_org_em on public.crm_etapas (org_id, em desc);
create index if not exists ix_crm_etapas_conversa on public.crm_etapas (conversa_id, em desc);
alter table public.crm_etapas enable row level security;
drop policy if exists crm_etapas_ler on public.crm_etapas;
create policy crm_etapas_ler on public.crm_etapas for select to authenticated using (org_id = (select public.org_atual()));
revoke all on public.crm_etapas from anon;

-- Nunca derruba a gravacao da conversa: qualquer erro aqui so deixa de registrar a etapa
create or replace function public.tg_crm_etapa() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not null and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    begin
      insert into public.crm_etapas (org_id, conversa_id, vendedor_id, etapa, anterior)
      values (new.org_id, new.id, new.vendedor_id, new.status, case when tg_op = 'UPDATE' then old.status end);
    exception when others then null;
    end;
  end if;
  return null;
end $$;
drop trigger if exists tg_crm_etapa on public.crm_conversas;
create trigger tg_crm_etapa after insert or update of status on public.crm_conversas
  for each row execute function public.tg_crm_etapa();
