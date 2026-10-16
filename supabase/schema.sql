-- =====================================================================
-- AUDITORIA COMERCIAL: schema completo para o SQL Editor do Supabase
-- Rode este arquivo inteiro uma vez. Pode rodar de novo sem quebrar.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
do $$ begin
  create type public.papel_usuario as enum ('admin', 'gestor', 'vendedor');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null default '',
  email     text not null default '',
  papel     public.papel_usuario not null default 'vendedor',
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Cria o profile automaticamente quando o admin cria um usuario (cadastro publico fica desativado no painel)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'vendedor' -- nunca confiar no papel vindo do cadastro: so o admin promove (Server Action)
  )
  on conflict (id) do nothing;
  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Funcoes de papel (usadas nas politicas de RLS) ----------
create or replace function public.papel_atual() returns public.papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from public.profiles where id = auth.uid() and ativo
$$;
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'admin' from public.profiles where id = auth.uid() and ativo), false)
$$;
create or replace function public.eh_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('admin', 'gestor') from public.profiles where id = auth.uid() and ativo), false)
$$;
revoke all on function public.papel_atual(), public.eh_admin(), public.eh_gestor() from public, anon;
grant execute on function public.papel_atual(), public.eh_admin(), public.eh_gestor() to authenticated;

-- ---------- instancias_whatsapp ----------
create table if not exists public.instancias_whatsapp (
  id            uuid primary key default gen_random_uuid(),
  vendedor_id   uuid not null references public.profiles(id) on delete cascade,
  nome          text not null,
  numero        text,
  status        text not null default 'aguardando' check (status in ('aguardando','aguardando_qr','conectando','conectado','desconectado','erro')),
  qr            text,                       -- texto do QR atual, escrito pelo worker
  comando       text check (comando in ('reset')),  -- 'reset' = desconectar e gerar novo QR
  atualizado_em timestamptz not null default now(),
  criado_em     timestamptz not null default now()
);
create index if not exists ix_inst_vendedor on public.instancias_whatsapp(vendedor_id);

-- ---------- conversas (um contato por dia por instancia) ----------
create table if not exists public.conversas (
  id            uuid primary key default gen_random_uuid(),
  vendedor_id   uuid not null references public.profiles(id) on delete cascade,
  instancia_id  uuid references public.instancias_whatsapp(id) on delete set null,
  contato       text not null,              -- numero ou id do WhatsApp
  contato_nome  text,
  canal         text not null default 'whatsapp',
  data          date not null,
  ultima_msg_em timestamptz not null default now(),
  criado_em     timestamptz not null default now(),
  unique (instancia_id, contato, data)
);
create index if not exists ix_conv_vendedor_data on public.conversas(vendedor_id, data desc);

-- ---------- mensagens ----------
create table if not exists public.mensagens (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  vendedor_id uuid not null references public.profiles(id) on delete cascade,
  wa_id       text not null,
  remetente   text not null check (remetente in ('vendedor','cliente')),
  texto       text,
  tipo        text not null default 'texto' check (tipo in ('texto','audio','imagem','video','documento','outro')),
  audio_url   text,                         -- caminho no bucket 'audios'
  transcricao text,
  enviada_em  timestamptz not null,
  espelhada   boolean not null default false,   -- ja foi para a planilha
  unique (conversa_id, wa_id)
);
create index if not exists ix_msg_conversa on public.mensagens(conversa_id, enviada_em);
create index if not exists ix_msg_pend_audio on public.mensagens(tipo) where tipo = 'audio' and transcricao is null;
create index if not exists ix_msg_espelho on public.mensagens(espelhada) where espelhada = false;

-- ---------- ligacoes ----------
create table if not exists public.ligacoes (
  id           uuid primary key default gen_random_uuid(),
  vendedor_id  uuid not null references public.profiles(id) on delete cascade,
  instancia_id uuid references public.instancias_whatsapp(id) on delete set null,
  contato      text not null,
  duracao_seg  integer,
  audio_url    text,                        -- caminho no bucket 'audios'
  transcricao  text,
  origem       text not null default 'manual' check (origem in ('manual','whatsapp')),
  iniciada_em  timestamptz not null default now(),
  criado_em    timestamptz not null default now()
);
create index if not exists ix_lig_vendedor on public.ligacoes(vendedor_id, iniciada_em desc);

-- ---------- auditorias ----------
create table if not exists public.auditorias (
  id             uuid primary key default gen_random_uuid(),
  conversa_id    uuid unique references public.conversas(id) on delete cascade,
  ligacao_id     uuid unique references public.ligacoes(id) on delete cascade,
  vendedor_id    uuid not null references public.profiles(id) on delete cascade,
  nota_geral     numeric(3,1) not null check (nota_geral between 0 and 10),
  notas          jsonb not null default '{}',   -- nota de 0 a 10 por criterio
  gatilhos       jsonb not null default '{}',   -- gatilhos comerciais usados (true/false)
  pontos_fortes  text,
  pontos_melhoria text,
  resumo         text,
  qualidade      text check (qualidade in ('boa','regular','ruim')),
  etapa          text,
  objecoes       text,
  agendou        boolean not null default false,
  efetiva        boolean not null default false,
  msg_count      integer not null default 0,
  modelo         text,
  sheet_row      integer,                       -- linha no espelho do Google Sheets
  sheet_ok       boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  check ((conversa_id is not null)::int + (ligacao_id is not null)::int = 1)
);
create index if not exists ix_aud_vendedor on public.auditorias(vendedor_id, criado_em desc);

-- ---------- config_auditoria (roteiro editavel pelo admin) ----------
create table if not exists public.config_auditoria (
  id       integer primary key default 1 check (id = 1),
  roteiro  text not null,
  criterios jsonb not null default '["abertura","descoberta","beneficio","objecoes","chamada_para_acao","tom"]',
  atualizado_em timestamptz not null default now()
);
insert into public.config_auditoria (roteiro) values (
'# Roteiro do convite para o workshop (edite no painel, em Roteiro)

## Um bom contato tem
1. Abertura pessoal: cita quem indicou o lead e a oficina de origem.
2. Motivo claro: convite para o workshop.
3. Pergunta aberta para entender o momento do lead.
4. Beneficio do workshop em 1 ou 2 frases.
5. Tratamento de objecao (sem tempo, sem interesse, quanto custa).
6. Proposta objetiva de data e horario.
7. Confirmacao do agendamento com dia, hora e local ou link.

## Conversa efetiva
O lead respondeu e houve troca real sobre o convite.

## Agendado
O lead aceitou data ou horario para o workshop.

## Tom
Informal, direto, respeitoso. Sem pressao exagerada, sem mensagem gigante.')
on conflict (id) do nothing;

-- ---------- analises_time (analise comercial gerada pela IA) ----------
create table if not exists public.analises_time (
  id           uuid primary key default gen_random_uuid(),
  periodo      text not null default '7' check (periodo in ('hoje','7','30')),
  status       text not null default 'pendente' check (status in ('pendente','pronta','erro')),
  texto        text,
  erro         text,
  solicitado_por uuid references public.profiles(id) on delete set null,
  criado_em    timestamptz not null default now()
);

-- =====================================================================
-- ROW LEVEL SECURITY
-- vendedor ve so os proprios dados. gestor e admin veem tudo.
-- O worker usa a service_role key, que ignora RLS (fica so no servidor).
-- =====================================================================
alter table public.profiles            enable row level security;
alter table public.instancias_whatsapp enable row level security;
alter table public.conversas           enable row level security;
alter table public.mensagens           enable row level security;
alter table public.ligacoes            enable row level security;
alter table public.auditorias          enable row level security;
alter table public.config_auditoria    enable row level security;
alter table public.analises_time       enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.eh_gestor());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- instancias_whatsapp
drop policy if exists inst_select on public.instancias_whatsapp;
create policy inst_select on public.instancias_whatsapp for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_gestor());
drop policy if exists inst_admin_write on public.instancias_whatsapp;
create policy inst_admin_write on public.instancias_whatsapp for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- conversas
drop policy if exists conv_select on public.conversas;
create policy conv_select on public.conversas for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_gestor());

-- mensagens
drop policy if exists msg_select on public.mensagens;
create policy msg_select on public.mensagens for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_gestor());

-- ligacoes (o vendedor pode registrar as proprias ligacoes enviando o audio)
drop policy if exists lig_select on public.ligacoes;
create policy lig_select on public.ligacoes for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_gestor());
drop policy if exists lig_insert on public.ligacoes;
create policy lig_insert on public.ligacoes for insert to authenticated
  with check (public.papel_atual() is not null and (vendedor_id = auth.uid() or public.eh_gestor()));

-- auditorias
drop policy if exists aud_select on public.auditorias;
create policy aud_select on public.auditorias for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_gestor());

-- config_auditoria: gestor le, so admin altera
drop policy if exists cfg_select on public.config_auditoria;
create policy cfg_select on public.config_auditoria for select to authenticated using (public.eh_gestor());
drop policy if exists cfg_admin_write on public.config_auditoria;
create policy cfg_admin_write on public.config_auditoria for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- analises_time: so gestor e admin
drop policy if exists ana_select on public.analises_time;
create policy ana_select on public.analises_time for select to authenticated using (public.eh_gestor());
drop policy if exists ana_insert on public.analises_time;
create policy ana_insert on public.analises_time for insert to authenticated
  with check (public.eh_gestor() and status = 'pendente' and texto is null);

-- =====================================================================
-- STORAGE: bucket privado 'audios' com RLS
-- Caminho dos arquivos: <vendedor_id>/<qualquer-coisa>
-- =====================================================================
insert into storage.buckets (id, name, public) values ('audios', 'audios', false)
on conflict (id) do update set public = false;

drop policy if exists audios_select on storage.objects;
create policy audios_select on storage.objects for select to authenticated
  using (bucket_id = 'audios' and ((storage.foldername(name))[1] = auth.uid()::text or public.eh_gestor()));
drop policy if exists audios_insert on storage.objects;
create policy audios_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'audios' and public.papel_atual() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists audios_delete on storage.objects;
create policy audios_delete on storage.objects for delete to authenticated
  using (bucket_id = 'audios' and public.eh_admin());

-- =====================================================================
-- Resumo do periodo por vendedor (SECURITY INVOKER: a RLS continua valendo,
-- entao o vendedor so enxerga os proprios numeros)
-- =====================================================================
create or replace function public.resumo_por_vendedor(p_from date, p_to date)
returns table (vendedor_id uuid, tratadas bigint, enviadas bigint, recebidas bigint, responderam bigint)
language sql stable security invoker set search_path = public as $$
  with base as (
    select c.id as conversa_id from public.conversas c where c.data between p_from and p_to
  ), msgs as (
    select m.conversa_id, m.vendedor_id,
      sum((m.remetente = 'vendedor')::int) as env,
      sum((m.remetente = 'cliente')::int)  as rec,
      min(m.enviada_em) filter (where m.remetente = 'vendedor') as primeira_v,
      max(m.enviada_em) filter (where m.remetente = 'cliente')  as ultima_c
    from public.mensagens m join base b on b.conversa_id = m.conversa_id
    group by m.conversa_id, m.vendedor_id
  )
  select vendedor_id,
    count(*) filter (where env > 0),
    coalesce(sum(env), 0)::bigint,
    coalesce(sum(rec), 0)::bigint,
    count(*) filter (where rec > 0 and primeira_v is not null and ultima_c > primeira_v)
  from msgs group by vendedor_id
$$;
grant execute on function public.resumo_por_vendedor(date, date) to authenticated;

-- =====================================================================
-- Realtime: o painel atualiza sozinho quando chegam mensagens e auditorias
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.mensagens;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.auditorias;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.instancias_whatsapp;
exception when others then null; end $$;

-- =====================================================================
-- DEPOIS DE RODAR: crie o primeiro admin
-- 1) Supabase > Authentication > Users > Add user (e-mail e senha, marque Auto Confirm)
-- 2) Rode (troque o e-mail):
--    update public.profiles set papel = 'admin', nome = 'Seu nome' where email = 'voce@empresa.com';
-- =====================================================================

-- =====================================================================
-- PAINEL DOS SDRs: numeros por dia, atividade ao vivo e conversas sem retorno
-- Todas SECURITY INVOKER: a RLS continua valendo (vendedor ve so os proprios dados).
-- Pode rodar de novo sem quebrar.
-- =====================================================================

create index if not exists ix_msg_vendedor_env on public.mensagens(vendedor_id, enviada_em desc) where remetente = 'vendedor';

-- Numeros por dia e por vendedor no periodo
-- contatadas: conversas em que o vendedor enviou mensagem
-- respostas: conversas em que o lead respondeu depois da primeira mensagem do vendedor
-- agendados, auditadas e nota: auditorias de conversas e de ligacoes do dia
create or replace function public.resumo_diario(p_from date, p_to date)
returns table (dia date, vendedor_id uuid, contatadas bigint, enviadas bigint, respostas bigint, ligacoes bigint,
               auditadas bigint, nota_soma numeric, agendados bigint, efetivas bigint)
language sql stable security invoker set search_path = public as $$
  with msgs as (
    select c.data as dia, m.conversa_id, m.vendedor_id,
      sum((m.remetente = 'vendedor')::int) as env,
      min(m.enviada_em) filter (where m.remetente = 'vendedor') as primeira_v,
      max(m.enviada_em) filter (where m.remetente = 'cliente')  as ultima_c
    from public.conversas c join public.mensagens m on m.conversa_id = c.id
    where c.data between p_from and p_to
    group by c.data, m.conversa_id, m.vendedor_id
  ), conv as (
    select dia, vendedor_id,
      count(*) filter (where env > 0) as contatadas,
      coalesce(sum(env), 0)::bigint as enviadas,
      count(*) filter (where env > 0 and ultima_c > primeira_v) as respostas
    from msgs group by dia, vendedor_id
  ), lig as (
    select (iniciada_em at time zone 'America/Sao_Paulo')::date as dia, vendedor_id, count(*) as ligacoes
    from public.ligacoes
    where (iniciada_em at time zone 'America/Sao_Paulo')::date between p_from and p_to
    group by 1, 2
  ), aud as (
    select coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) as dia, a.vendedor_id,
      count(*) as auditadas, sum(a.nota_geral) as nota_soma,
      count(*) filter (where a.agendou) as agendados, count(*) filter (where a.efetiva) as efetivas
    from public.auditorias a
    left join public.conversas c on c.id = a.conversa_id
    left join public.ligacoes l on l.id = a.ligacao_id
    where coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) between p_from and p_to
    group by 1, 2
  ), chaves as (
    select dia, vendedor_id from conv union select dia, vendedor_id from lig union select dia, vendedor_id from aud
  )
  select k.dia, k.vendedor_id,
    coalesce(conv.contatadas, 0), coalesce(conv.enviadas, 0), coalesce(conv.respostas, 0), coalesce(lig.ligacoes, 0),
    coalesce(aud.auditadas, 0), coalesce(aud.nota_soma, 0), coalesce(aud.agendados, 0), coalesce(aud.efetivas, 0)
  from chaves k
  left join conv using (dia, vendedor_id)
  left join lig using (dia, vendedor_id)
  left join aud using (dia, vendedor_id)
  order by k.dia, k.vendedor_id
$$;
grant execute on function public.resumo_diario(date, date) to authenticated;

-- Ultima acao de cada vendedor (para a atividade ao vivo)
create or replace function public.ultima_atividade()
returns table (vendedor_id uuid, ultima_msg_em timestamptz, ultima_ligacao_em timestamptz, conversas_hoje bigint)
language sql stable security invoker set search_path = public as $$
  select p.id,
    (select max(m.enviada_em) from public.mensagens m where m.vendedor_id = p.id and m.remetente = 'vendedor'),
    (select max(l.iniciada_em) from public.ligacoes l where l.vendedor_id = p.id),
    (select count(*) from public.conversas c where c.vendedor_id = p.id and c.data = (now() at time zone 'America/Sao_Paulo')::date)
  from public.profiles p
  where p.ativo
$$;
grant execute on function public.ultima_atividade() to authenticated;

-- Conversas do periodo em que a ultima mensagem e do lead e ninguem respondeu ha mais de p_min minutos
create or replace function public.conversas_sem_retorno(p_from date, p_to date, p_min integer default 15)
returns table (conversa_id uuid, vendedor_id uuid, contato text, contato_nome text, ultima_msg_em timestamptz, texto text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.vendedor_id, c.contato, c.contato_nome, u.enviada_em,
    coalesce(u.texto, u.transcricao, '[' || u.tipo || ']')
  from public.conversas c
  cross join lateral (
    select m.remetente, m.texto, m.transcricao, m.tipo, m.enviada_em
    from public.mensagens m where m.conversa_id = c.id order by m.enviada_em desc limit 1
  ) u
  where c.data between p_from and p_to
    and u.remetente = 'cliente'
    and u.enviada_em < now() - make_interval(mins => p_min)
  order by u.enviada_em
  limit 100
$$;
grant execute on function public.conversas_sem_retorno(date, date, integer) to authenticated;

-- =====================================================================
-- Sinal de vida do worker: ele atualiza visto_em a cada ciclo de conexoes.
-- A tela WhatsApp usa isso para avisar quando o worker esta desligado.
-- =====================================================================
create table if not exists public.worker_status (
  id         integer primary key default 1 check (id = 1),
  visto_em   timestamptz not null default now(),
  conexoes   integer not null default 0
);
alter table public.worker_status enable row level security;
drop policy if exists worker_status_select on public.worker_status;
create policy worker_status_select on public.worker_status for select to authenticated using (public.eh_gestor());

-- =====================================================================
-- Tokens das instancias na Uazapi. So o worker (service role) le: RLS ligada e nenhuma politica.
-- =====================================================================
create table if not exists public.instancias_uazapi (
  instancia_id  uuid primary key references public.instancias_whatsapp(id) on delete cascade,
  nome          text not null,
  token         text not null,
  criado_em     timestamptz not null default now()
);
alter table public.instancias_uazapi enable row level security;
revoke all on public.instancias_uazapi from anon, authenticated;

-- =====================================================================
-- Conversas importadas (tela Testar auditor, canal = 'importada') ficam fora
-- das metas, da atividade ao vivo e de "sem retorno". Substitui as versoes acima.
-- =====================================================================
create or replace function public.resumo_diario(p_from date, p_to date)
returns table (dia date, vendedor_id uuid, contatadas bigint, enviadas bigint, respostas bigint, ligacoes bigint,
               auditadas bigint, nota_soma numeric, agendados bigint, efetivas bigint)
language sql stable security invoker set search_path = public as $$
  with msgs as (
    select c.data as dia, m.conversa_id, m.vendedor_id,
      sum((m.remetente = 'vendedor')::int) as env,
      min(m.enviada_em) filter (where m.remetente = 'vendedor') as primeira_v,
      max(m.enviada_em) filter (where m.remetente = 'cliente')  as ultima_c
    from public.conversas c join public.mensagens m on m.conversa_id = c.id
    where c.data between p_from and p_to and c.canal <> 'importada'
    group by c.data, m.conversa_id, m.vendedor_id
  ), conv as (
    select dia, vendedor_id,
      count(*) filter (where env > 0) as contatadas,
      coalesce(sum(env), 0)::bigint as enviadas,
      count(*) filter (where env > 0 and ultima_c > primeira_v) as respostas
    from msgs group by dia, vendedor_id
  ), lig as (
    select (iniciada_em at time zone 'America/Sao_Paulo')::date as dia, vendedor_id, count(*) as ligacoes
    from public.ligacoes
    where (iniciada_em at time zone 'America/Sao_Paulo')::date between p_from and p_to
    group by 1, 2
  ), aud as (
    select coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) as dia, a.vendedor_id,
      count(*) as auditadas, sum(a.nota_geral) as nota_soma,
      count(*) filter (where a.agendou) as agendados, count(*) filter (where a.efetiva) as efetivas
    from public.auditorias a
    left join public.conversas c on c.id = a.conversa_id
    left join public.ligacoes l on l.id = a.ligacao_id
    where coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) between p_from and p_to
      and coalesce(c.canal, '') <> 'importada'
    group by 1, 2
  ), chaves as (
    select dia, vendedor_id from conv union select dia, vendedor_id from lig union select dia, vendedor_id from aud
  )
  select k.dia, k.vendedor_id,
    coalesce(conv.contatadas, 0), coalesce(conv.enviadas, 0), coalesce(conv.respostas, 0), coalesce(lig.ligacoes, 0),
    coalesce(aud.auditadas, 0), coalesce(aud.nota_soma, 0), coalesce(aud.agendados, 0), coalesce(aud.efetivas, 0)
  from chaves k
  left join conv using (dia, vendedor_id)
  left join lig using (dia, vendedor_id)
  left join aud using (dia, vendedor_id)
  order by k.dia, k.vendedor_id
$$;

create or replace function public.ultima_atividade()
returns table (vendedor_id uuid, ultima_msg_em timestamptz, ultima_ligacao_em timestamptz, conversas_hoje bigint)
language sql stable security invoker set search_path = public as $$
  select p.id,
    (select max(m.enviada_em) from public.mensagens m join public.conversas c on c.id = m.conversa_id
      where m.vendedor_id = p.id and m.remetente = 'vendedor' and c.canal <> 'importada'),
    (select max(l.iniciada_em) from public.ligacoes l where l.vendedor_id = p.id),
    (select count(*) from public.conversas c where c.vendedor_id = p.id and c.canal <> 'importada'
      and c.data = (now() at time zone 'America/Sao_Paulo')::date)
  from public.profiles p
  where p.ativo
$$;

create or replace function public.conversas_sem_retorno(p_from date, p_to date, p_min integer default 15)
returns table (conversa_id uuid, vendedor_id uuid, contato text, contato_nome text, ultima_msg_em timestamptz, texto text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.vendedor_id, c.contato, c.contato_nome, u.enviada_em,
    coalesce(u.texto, u.transcricao, '[' || u.tipo || ']')
  from public.conversas c
  cross join lateral (
    select m.remetente, m.texto, m.transcricao, m.tipo, m.enviada_em
    from public.mensagens m where m.conversa_id = c.id order by m.enviada_em desc limit 1
  ) u
  where c.data between p_from and p_to
    and c.canal <> 'importada'
    and u.remetente = 'cliente'
    and u.enviada_em < now() - make_interval(mins => p_min)
  order by u.enviada_em
  limit 100
$$;

-- =====================================================================
-- Marcacoes: a IA classifica o agendamento em workshop ou reuniao de imersao.
-- resumo_sdr: numeros por dia e por SDR para o Painel e a Apresentacao.
-- =====================================================================
alter table public.auditorias add column if not exists tipo_agendamento text check (tipo_agendamento in ('workshop','imersao'));

create or replace function public.resumo_sdr(p_from date, p_to date)
returns table (dia date, vendedor_id uuid, contatadas bigint, enviadas bigint, respostas bigint, ligacoes bigint,
               auditadas bigint, nota_soma numeric, efetivas bigint, marcacoes bigint, workshop bigint, imersao bigint)
language sql stable security invoker set search_path = public as $$
  with msgs as (
    select c.data as dia, m.conversa_id, m.vendedor_id,
      sum((m.remetente = 'vendedor')::int) as env,
      sum((m.remetente = 'cliente')::int) as rec
    from public.conversas c join public.mensagens m on m.conversa_id = c.id
    where c.data between p_from and p_to and c.canal <> 'importada'
    group by c.data, m.conversa_id, m.vendedor_id
  ), conv as (
    select dia, vendedor_id,
      count(*) filter (where env > 0) as contatadas,
      coalesce(sum(env), 0)::bigint as enviadas,
      count(*) filter (where env > 0 and rec > 0) as respostas
    from msgs group by dia, vendedor_id
  ), lig as (
    select (iniciada_em at time zone 'America/Sao_Paulo')::date as dia, vendedor_id, count(*) as ligacoes
    from public.ligacoes
    where (iniciada_em at time zone 'America/Sao_Paulo')::date between p_from and p_to
    group by 1, 2
  ), aud as (
    select coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) as dia, a.vendedor_id,
      count(*) as auditadas, sum(a.nota_geral) as nota_soma, count(*) filter (where a.efetiva) as efetivas,
      count(*) filter (where a.agendou) as marcacoes,
      count(*) filter (where a.agendou and coalesce(a.tipo_agendamento, 'workshop') = 'workshop') as workshop,
      count(*) filter (where a.agendou and a.tipo_agendamento = 'imersao') as imersao
    from public.auditorias a
    left join public.conversas c on c.id = a.conversa_id
    left join public.ligacoes l on l.id = a.ligacao_id
    where coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) between p_from and p_to
      and coalesce(c.canal, '') <> 'importada'
    group by 1, 2
  ), chaves as (
    select dia, vendedor_id from conv union select dia, vendedor_id from lig union select dia, vendedor_id from aud
  )
  select k.dia, k.vendedor_id,
    coalesce(conv.contatadas, 0), coalesce(conv.enviadas, 0), coalesce(conv.respostas, 0), coalesce(lig.ligacoes, 0),
    coalesce(aud.auditadas, 0), coalesce(aud.nota_soma, 0), coalesce(aud.efetivas, 0),
    coalesce(aud.marcacoes, 0), coalesce(aud.workshop, 0), coalesce(aud.imersao, 0)
  from chaves k
  left join conv using (dia, vendedor_id)
  left join lig using (dia, vendedor_id)
  left join aud using (dia, vendedor_id)
  order by k.dia, k.vendedor_id
$$;
grant execute on function public.resumo_sdr(date, date) to authenticated;
