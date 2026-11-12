-- Retrato dos follow-ups atrasados por vendedor, para a TV (card de cada pessoa). Gravado pelo worker
-- (worker/src/followup.js, fotografarFollowups) a cada 15 min, com a mesma regra do aviso de follow-up:
-- cliente potencial sem mensagem do time ha "followup_alerta_d" dias ou mais (Configuracoes, padrao 6).
create table if not exists public.followups_atrasados (
  vendedor_id      uuid primary key references public.profiles(id) on delete cascade,
  org_id           uuid references public.organizacoes(id),
  qtd              integer not null default 0,
  mais_antigo_dias integer,
  dias_regra       integer,
  calculado_em     timestamptz not null default now()
);
alter table public.followups_atrasados enable row level security;
drop policy if exists followups_atrasados_ler on public.followups_atrasados;
create policy followups_atrasados_ler on public.followups_atrasados for select to authenticated using (org_id = (select public.org_atual()));
revoke all on public.followups_atrasados from anon;
