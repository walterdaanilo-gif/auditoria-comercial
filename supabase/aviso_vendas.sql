-- Aviso de venda no WhatsApp do Bruno: toda venda de Imersao ou Plataforma que entra no faturamento e avisada uma vez.
-- vendas_avisadas guarda quais ja foram avisadas (chave = a mesma da aba Resultados: a:<auditoria>, m:<id> ou c:<negocio>#n).
-- Rodar ANTES de publicar o site e o worker com este aviso. A primeira chamada nao envia nada: so anota as vendas que ja existem.
create table if not exists public.vendas_avisadas (
  org_id     uuid not null references public.organizacoes(id),
  chave      text not null,
  inicial    boolean not null default false,   -- true = ja existia quando o aviso foi ligado (nao gerou mensagem)
  avisada_em timestamptz not null default now(),
  primary key (org_id, chave)
);
alter table public.vendas_avisadas enable row level security;
revoke all on public.vendas_avisadas from anon, authenticated;   -- so o servidor (service role) escreve e le

-- relogio: a cada 15 min, 3 minutos depois da sincronizacao do CRM (minutos 7, 22, 37, 52)
-- troque a URL se o site publicado tiver outro endereco
create or replace function public.disparar_aviso_vendas() returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://auditoria-comercial-omega.vercel.app/api/avisos/vendas',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-token', (select token from worker_token where id = 1)),
    timeout_milliseconds := 120000);
$$;
revoke all on function public.disparar_aviso_vendas() from public, anon, authenticated;
select cron.schedule('aviso-vendas-15min', '10,25,40,55 * * * *', 'select public.disparar_aviso_vendas()');
