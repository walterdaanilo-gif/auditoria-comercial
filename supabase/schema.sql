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

-- =====================================================================
-- Tempos de resposta do SDR, calculados pelo worker na auditoria:
-- primeira_resposta_seg = da 1a mensagem do lead ate a 1a resposta do SDR depois dela
-- tempo_medio_resposta_seg = media de cada vez que o lead escreveu ate o SDR responder
-- respostas_sdr = quantas vezes isso aconteceu (base da media)
-- =====================================================================
alter table public.auditorias add column if not exists primeira_resposta_seg integer;
alter table public.auditorias add column if not exists tempo_medio_resposta_seg integer;
alter table public.auditorias add column if not exists respostas_sdr integer;

-- =====================================================================
-- CONFIGURACOES DO AUDITOR (tela Configuracoes, so gestor/admin edita)
-- =====================================================================

-- Funcao comercial do vendedor: SDR (workshop e reuniao de imersao) ou Closer (implementacao e fechamento da imersao)
alter table public.profiles add column if not exists funcao text not null default 'sdr';
do $$ begin
  alter table public.profiles add constraint profiles_funcao_ck check (funcao in ('sdr','closer'));
exception when duplicate_object then null; end $$;

-- Horario proprio do numero (usado quando horario_modo = 'numero')
alter table public.instancias_whatsapp add column if not exists horario jsonb;

-- Configuracao unica da Weevo (1 linha)
create table if not exists public.audit_settings (
  id                     integer primary key default 1 check (id = 1),
  auditoria_automatica   boolean not null default true,
  escopo_conversas       text not null default 'individual' check (escopo_conversas in ('todas','individual','grupo')),
  min_mensagens          integer check (min_mensagens between 1 and 200),   -- null = padrao do app (4)
  amostragem_pct         integer check (amostragem_pct between 1 and 100),  -- null = padrao do app (100)
  so_com_proposta        boolean not null default false,
  regras_criticas        text[] not null default '{}',
  sla_primeira_resposta_min integer not null default 15 check (sla_primeira_resposta_min between 1 and 10080),
  followup_sem_resposta_h integer not null default 24 check (followup_sem_resposta_h between 1 and 720),
  followup_abandonada_d   integer not null default 3 check (followup_abandonada_d between 1 and 90),
  followup_limite_d       integer not null default 14 check (followup_limite_d between 1 and 365),
  horario_modo           text not null default 'desligado' check (horario_modo in ('desligado','empresa','numero')),
  horario_empresa        jsonb not null default '{"dias":[1,2,3,4,5],"inicio":"08:00","fim":"18:00"}',
  alerta_venda           boolean not null default true,
  alerta_oportunidade    boolean not null default false,
  alerta_formato         text not null default 'detalhado' check (alerta_formato in ('resumido','detalhado')),
  instancia_envio_id     uuid references public.instancias_whatsapp(id) on delete set null, -- WhatsApp que envia alertas e resumo
  resumo_ativo           boolean not null default true,
  resumo_hora            text not null default '19:00' check (resumo_hora in ('07:00','12:00','19:00','21:00')),
  resumo_dias            integer[] not null default '{1,2,3,4,5}',
  resumo_ultimo_envio    timestamptz,
  rubrica_modo           text not null default 'sistema' check (rubrica_modo in ('sistema','personalizada')),
  venda_conta            text[] not null default '{}',
  venda_nao_conta        text[] not null default '{}',
  oportunidade_conta     text[] not null default '{}',
  oportunidade_nao_conta text[] not null default '{}',
  meta_sdr_contatos      integer not null default 30, -- nao usada: a meta do SDR passou a ser conversas trocadas
  meta_sdr_conversas     integer not null default 25,
  meta_sdr_marcacoes     integer not null default 6,
  meta_closer_reunioes   integer,
  meta_closer_vendas     integer,
  atualizado_em          timestamptz not null default now()
);
insert into public.audit_settings (id, regras_criticas, venda_conta, venda_nao_conta, oportunidade_conta, oportunidade_nao_conta) values (1,
  array['Lead ameaçou reclamar publicamente ou no Procon','SDR ou closer prometeu algo que a Weevo não oferece','Lead pediu para não ser mais contatado e o contato continuou'],
  array['Lead confirmou a inscrição no workshop','Lead usou cupom de convite do workshop','Lead enviou comprovante de pagamento','Lead assinou o contrato da imersão'],
  array['Lead disse "vou pensar"','Pagamento prometido mas não confirmado','Reunião marcada (é oportunidade, não venda)'],
  array['Lead quer saber datas ou valores do workshop','Lead quer saber sobre a imersão','Reunião de imersão marcada','Reunião de implementação marcada'],
  array['Curiosidade sem intenção','Conversa pessoal sem contexto comercial','Spam ou bot'])
on conflict (id) do nothing;
-- Meta do SDR: conversas trocadas (o lead respondeu) no lugar de contatos
alter table public.audit_settings add column if not exists meta_sdr_conversas integer not null default 25;

-- Numeros que nunca sao auditados automaticamente (55 + DDD + numero)
create table if not exists public.numeros_ignorados (
  telefone  text primary key check (telefone ~ '^55[0-9]{10,11}$'),
  motivo    text,
  criado_em timestamptz not null default now()
);

-- Telefones que recebem alertas e o resumo diario (no maximo 3)
create table if not exists public.telefones_alerta (
  telefone  text primary key check (telefone ~ '^55[0-9]{10,11}$'),
  criado_em timestamptz not null default now()
);
create or replace function public.limite_telefones_alerta() returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.telefones_alerta) > 3 then raise exception 'No máximo 3 telefones de alerta'; end if;
  return null;
end $$;
create or replace trigger trg_limite_telefones_alerta after insert on public.telefones_alerta
  for each statement execute function public.limite_telefones_alerta();

-- Rubrica: criterios por funcao (sdr, closer) ou a personalizada (vale para todos)
create table if not exists public.criterios_rubrica (
  id        uuid primary key default gen_random_uuid(),
  rubrica   text not null check (rubrica in ('sdr','closer','personalizada')),
  chave     text not null,
  nome      text not null,
  descricao text not null default '',
  peso      integer not null check (peso between 0 and 100),
  ativo     boolean not null default true,
  posicao   integer not null default 0,
  unique (rubrica, chave)
);

-- Pesos ativos de cada rubrica precisam somar 100 (checado no fim da transacao)
create or replace function public.checar_pesos_rubrica() returns trigger language plpgsql set search_path = public as $$
declare r text; s integer;
begin
  for r in select distinct rubrica from public.criterios_rubrica loop
    select coalesce(sum(peso), 0) into s from public.criterios_rubrica where rubrica = r and ativo;
    if s <> 100 then raise exception 'Os pesos da rubrica % somam % por cento; precisam somar 100', r, s; end if;
  end loop;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_pesos_rubrica') then
    create constraint trigger trg_pesos_rubrica after insert or update or delete on public.criterios_rubrica
      deferrable initially deferred for each row execute function public.checar_pesos_rubrica();
  end if;
end $$;



-- Salva uma rubrica inteira de uma vez (a soma 100 e checada no fim); criterio removido fica inativo
create or replace function public.salvar_rubrica(p_rubrica text, p_criterios jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.eh_gestor() then raise exception 'Sem permissão'; end if;
  update public.criterios_rubrica set ativo = false
   where rubrica = p_rubrica and chave not in (select c->>'chave' from jsonb_array_elements(p_criterios) c);
  insert into public.criterios_rubrica (rubrica, chave, nome, descricao, peso, ativo, posicao)
  select p_rubrica, c->>'chave', c->>'nome', coalesce(c->>'descricao',''), (c->>'peso')::int, coalesce((c->>'ativo')::boolean, true), ord::int
    from jsonb_array_elements(p_criterios) with ordinality as t(c, ord)
  on conflict (rubrica, chave) do update set nome = excluded.nome, descricao = excluded.descricao, peso = excluded.peso, ativo = excluded.ativo, posicao = excluded.posicao;
end $$;
revoke all on function public.salvar_rubrica(text, jsonb) from public, anon;
grant execute on function public.salvar_rubrica(text, jsonb) to authenticated;

-- Notificacoes no app (alerta critico vai so por aqui)
create table if not exists public.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  para        uuid not null references public.profiles(id) on delete cascade,
  tipo        text not null check (tipo in ('critico','venda','oportunidade','aviso')),
  titulo      text not null,
  texto       text,
  link        text,
  lida        boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_notif_para on public.notificacoes(para, lida, criado_em desc);

-- Resultado novo da auditoria
alter table public.auditorias add column if not exists rubrica text;
alter table public.auditorias add column if not exists notas_1a5 jsonb;
alter table public.auditorias add column if not exists venda boolean not null default false;
alter table public.auditorias add column if not exists venda_tipo text check (venda_tipo in ('workshop','imersao'));
alter table public.auditorias add column if not exists venda_valor numeric(12,2);
alter table public.auditorias add column if not exists venda_cupom boolean not null default false;
alter table public.auditorias add column if not exists venda_evidencia text;
alter table public.auditorias add column if not exists oportunidade boolean not null default false;
alter table public.auditorias add column if not exists oportunidade_tipo text check (oportunidade_tipo in ('interesse_workshop','interesse_imersao','reuniao_imersao','reuniao_implementacao'));
alter table public.auditorias add column if not exists oportunidade_evidencia text;
alter table public.auditorias add column if not exists critico boolean not null default false;
alter table public.auditorias add column if not exists critico_motivo text;
alter table public.auditorias add column if not exists so_bot boolean not null default false;
alter table public.auditorias add column if not exists manual boolean not null default false;
alter table public.auditorias add column if not exists alerta_enviado boolean not null default false;

-- Pedido de "Auditar agora" (o worker atende e limpa)
alter table public.conversas add column if not exists auditar_agora boolean not null default false;

-- RLS: gestor/admin le e edita; worker usa service role
alter table public.audit_settings    enable row level security;
alter table public.numeros_ignorados enable row level security;
alter table public.telefones_alerta  enable row level security;
alter table public.criterios_rubrica enable row level security;
alter table public.notificacoes      enable row level security;

do $$ begin
  create policy as_gestor on public.audit_settings for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
  create policy ni_gestor on public.numeros_ignorados for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
  create policy ta_gestor on public.telefones_alerta for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
  create policy cr_gestor on public.criterios_rubrica for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());
  create policy nt_select on public.notificacoes for select to authenticated using (para = auth.uid());
  create policy nt_update on public.notificacoes for update to authenticated using (para = auth.uid()) with check (para = auth.uid());
exception when duplicate_object then null; end $$;
revoke all on public.audit_settings, public.numeros_ignorados, public.telefones_alerta, public.criterios_rubrica, public.notificacoes from anon;

-- Rubricas padrao (por ultimo: o trigger de pesos e adiado e bloqueia ALTER TABLE depois dele)
insert into public.criterios_rubrica (rubrica, chave, nome, descricao, peso, posicao) values
  ('sdr','abordagem','Abordagem e personalização','Saudação cordial, cita quem indicou e o contexto do lead, tom leve e profissional.',15,1),
  ('sdr','descoberta','Descoberta do momento','Faz perguntas para entender o momento e o interesse do lead antes de convidar.',15,2),
  ('sdr','valor','Apresentação do valor','Explica com clareza o ganho do workshop ou da imersão, em poucas frases.',15,3),
  ('sdr','objecoes','Tratamento de objeções','Responde tempo, preço e interesse com argumento, sem evasivas.',15,4),
  ('sdr','conducao','Condução à inscrição ou reunião','Propõe data e horário, envia o link ou cupom e confirma a inscrição.',25,5),
  ('sdr','agilidade','Agilidade','Responde rápido e não deixa o lead esperando.',10,6),
  ('sdr','followup','Follow-up','Retoma o contato quando o lead esfria ou some.',5,7),
  ('closer','conexao','Conexão e abordagem','Retoma o contexto do lead e cria confiança desde o início.',10,1),
  ('closer','diagnostico','Diagnóstico da necessidade','Entende a dor, o objetivo e o momento antes de apresentar a imersão.',20,2),
  ('closer','apresentacao','Apresentação da imersão','Liga a imersão ao que o lead precisa, com condições claras.',15,3),
  ('closer','objecoes','Tratamento de objeções','Responde preço, prazo e dúvidas com argumento e prova.',20,4),
  ('closer','fechamento','Condução ao fechamento','Marca a reunião de implementação e pede o fechamento de forma concreta.',20,5),
  ('closer','agilidade','Agilidade','Responde rápido e mantém o ritmo da negociação.',5,6),
  ('closer','followup','Follow-up','Retoma quem esfriou com motivo e próximo passo.',10,7)
on conflict (rubrica, chave) do nothing;

-- =====================================================================
-- Ligacoes de WhatsApp captadas do numero conectado (o worker grava; sem audio)
-- atendida: o lead atendeu (gravacao enviada na mao conta como atendida)
-- =====================================================================
alter table public.ligacoes add column if not exists direcao text check (direcao in ('entrada','saida'));
alter table public.ligacoes add column if not exists atendida boolean not null default true;
alter table public.ligacoes add column if not exists resultado text;
alter table public.ligacoes add column if not exists wa_call_id text;
create unique index if not exists ux_lig_wa_call on public.ligacoes(instancia_id, wa_call_id) where wa_call_id is not null;
create index if not exists ix_lig_contato on public.ligacoes(instancia_id, contato, iniciada_em);
-- resumo_sdr2 = resumo_sdr + ligacoes_atendidas e ligacoes_seg (tempo falando nas atendidas)
create or replace function public.resumo_sdr2(p_from date, p_to date)
returns table (dia date, vendedor_id uuid, contatadas bigint, enviadas bigint, respostas bigint, ligacoes bigint, ligacoes_atendidas bigint, ligacoes_seg bigint,
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
    select (iniciada_em at time zone 'America/Sao_Paulo')::date as dia, vendedor_id, count(*) as ligacoes,
      count(*) filter (where atendida) as ligacoes_atendidas,
      coalesce(sum(duracao_seg) filter (where atendida), 0)::bigint as ligacoes_seg
    from public.ligacoes
    where (iniciada_em at time zone 'America/Sao_Paulo')::date between p_from and p_to
    group by 1, 2
  ), aud as (
    select coalesce(c.data, (l.iniciada_em at time zone 'America/Sao_Paulo')::date) as dia, a.vendedor_id,
      count(*) filter (where not a.so_bot) as auditadas, sum(a.nota_geral) filter (where not a.so_bot) as nota_soma, count(*) filter (where a.efetiva) as efetivas,
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
    coalesce(conv.contatadas, 0), coalesce(conv.enviadas, 0), coalesce(conv.respostas, 0),
    coalesce(lig.ligacoes, 0), coalesce(lig.ligacoes_atendidas, 0), coalesce(lig.ligacoes_seg, 0),
    coalesce(aud.auditadas, 0), coalesce(aud.nota_soma, 0), coalesce(aud.efetivas, 0),
    coalesce(aud.marcacoes, 0), coalesce(aud.workshop, 0), coalesce(aud.imersao, 0)
  from chaves k
  left join conv using (dia, vendedor_id)
  left join lig using (dia, vendedor_id)
  left join aud using (dia, vendedor_id)
  order by k.dia, k.vendedor_id
$$;
revoke all on function public.resumo_sdr2(date, date) from public, anon;
grant execute on function public.resumo_sdr2(date, date) to authenticated;

-- =====================================================================
-- Quando auditar: parada durante o dia, rodada final (fim do expediente) e historico do lead
-- =====================================================================
alter table public.audit_settings add column if not exists auditoria_parada_min integer default 120 check (auditoria_parada_min between 10 and 1440); -- null = so na rodada final
alter table public.audit_settings add column if not exists rodada_final_hora text not null default '18:00' check (rodada_final_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.audit_settings add column if not exists historico_dias integer not null default 7 check (historico_dias between 0 and 30);
alter table public.audit_settings add column if not exists rodada_final_ultima date; -- o worker marca o dia em que ja rodou

-- =====================================================================
-- Avisos na hora (venda, marcacao, oportunidade) no WhatsApp do gestor
-- conversas.auditar_rapido: o worker marca quando chega mensagem com sinal de venda ou marcacao
-- auditorias.alertas_enviados: eventos ja avisados desta conversa (nao repete)
-- =====================================================================
alter table public.audit_settings add column if not exists alerta_marcacao boolean not null default true;
alter table public.auditorias add column if not exists alertas_enviados text[] not null default '{}';
alter table public.conversas add column if not exists auditar_rapido boolean not null default false;
create index if not exists ix_conv_rapido on public.conversas(auditar_rapido) where auditar_rapido;
create index if not exists ix_conv_agora on public.conversas(auditar_agora) where auditar_agora;
-- (aplicado em 2026-10-17: a coluna meta_sdr_conversas faltava no banco e travava Configuracoes)
