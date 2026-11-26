-- Entrada de leads no topo do funil (Lead novo, Lead trafego, Formulario abandonado) de TODOS os numeros do CRM, inclusive
-- os que nao sao de um vendedor do sistema (ex.: "Comercial inbound", a API oficial, onde o lead de trafego chega primeiro).
-- Pedido da gestao, 26/11/2026: o KPI "Leads novos" da Conversao total conta TELEFONES unicos, na data do primeiro cartao
-- (o mesmo lead ganha um cartao na API e outro quando a SDR o recria no numero dela: conta uma vez so).
-- Gravado pela sincronizacao (crm-sync, a cada 5 min: cartao visto numa etapa de entrada) e pelo aviso do CRM (crm-vendas).
-- Comeca a contar quando foi aplicado: a API so mostra a etapa atual, os cartoes antigos ja encerrados nao tem mais etapa.
create table if not exists public.crm_entradas (
  id              bigserial primary key,
  org_id          uuid not null references public.organizacoes(id),
  conversa_crm_id uuid not null,
  etapa           text not null,
  telefone_chave  text not null, -- DDD + ultimos 8 digitos
  instancia       text,
  criada_crm_em   timestamptz,
  em              timestamptz not null default now(),
  unique (conversa_crm_id, etapa)
);
create index if not exists ix_crm_entradas_org_tel on public.crm_entradas (org_id, telefone_chave, em);
alter table public.crm_entradas enable row level security;
drop policy if exists crm_entradas_ler on public.crm_entradas;
create policy crm_entradas_ler on public.crm_entradas for select to authenticated using (org_id = (select public.org_atual()));
revoke all on public.crm_entradas from anon;
