-- Vendas do CRM Q5 (aba Vendas): negocios com produtos, importados pela Edge Function crm-vendas (supabase/functions/crm-vendas).
-- Precisa das permissoes deals:read e products:read na chave do CRM de cada empresa. Aplicado em 09/11/2026.
create table if not exists public.crm_vendas (
  deal_id text primary key,
  org_id uuid not null references public.organizacoes(id),
  chat_id text, contato_crm_id text, telefone text, cliente text,
  status text,                 -- won | lost | open
  valor_cents bigint, aberto_em timestamptz, ganho_em timestamptz,
  dono_crm_id text,
  vendedor_id uuid references public.profiles(id) on delete set null,
  sdr text, closer text,
  produto text,                -- produto principal (o primeiro da lista, ou o campo "produto vendido")
  tipo text,                   -- imersao | workshop | plataforma | incompany | outro
  produtos jsonb not null default '[]',
  campos jsonb not null default '{}',
  sincronizado_em timestamptz not null default now()
);
create index if not exists ix_crm_vendas_org_ganho on public.crm_vendas (org_id, ganho_em desc);
alter table public.crm_vendas enable row level security;
drop policy if exists crm_vendas_ler on public.crm_vendas;
create policy crm_vendas_ler on public.crm_vendas for select to authenticated using (org_id = (select public.org_atual()));

create table if not exists public.crm_produtos (
  id text primary key, org_id uuid not null references public.organizacoes(id), nome text, codigo text, preco_cents bigint, ativo boolean, tipo text, sincronizado_em timestamptz not null default now()
);
alter table public.crm_produtos enable row level security;
drop policy if exists crm_produtos_ler on public.crm_produtos;
create policy crm_produtos_ler on public.crm_produtos for select to authenticated using (org_id = (select public.org_atual()));

-- relogio: a cada 15 min (fora dos minutos cheios)
create or replace function public.crm_disparar_vendas() returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://vgenysegeelseyrvtnxu.supabase.co/functions/v1/crm-vendas',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-sync-token', (select token from crm_sync_token where id = 1)),
    timeout_milliseconds := 150000);
$$;
revoke all on function public.crm_disparar_vendas() from public, anon, authenticated;
select cron.schedule('crm-vendas-15min', '7,22,37,52 * * * *', 'select public.crm_disparar_vendas()');

-- controle de leitura por contato (a funcao le os negocios de cada contato, de qualquer instancia)
create table if not exists public.crm_contatos_lidos (contato_crm_id text primary key, org_id uuid not null references public.organizacoes(id), lido_em timestamptz not null default now());
alter table public.crm_contatos_lidos enable row level security;

-- quem leva todas as vendas de workshop (na Weevo, o Ruan)
alter table public.audit_settings add column if not exists vendedor_workshop uuid references public.profiles(id) on delete set null;
