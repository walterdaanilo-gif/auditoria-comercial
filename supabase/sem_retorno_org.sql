-- "Leads sem retorno" de UMA empresa (TV / Apresentacao, 25/11/2026). Mesma regra de conversas_sem_retorno
-- (supabase/sem_retorno_crm.sql), mas filtra a empresa ANTES do limite: a TV le com a chave de servico (sem RLS) e a
-- conta antiga trazia os 100 mais antigos de todas as empresas, cortando leads da Weevo. A conta antiga nao muda.
-- Ate 500 (a TV mostra o total e, no modal, as 100 esperas mais longas).
create or replace function public.conversas_sem_retorno_org(p_org uuid, p_from date, p_to date, p_min integer default 15)
returns table (conversa_id uuid, vendedor_id uuid, contato text, contato_nome text, ultima_msg_em timestamptz, texto text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.vendedor_id, c.contato, c.contato_nome, u.enviada_em,
    coalesce(u.texto, u.transcricao, '[' || u.tipo || ']')
  from public.conversas c
  cross join lateral (
    select m.remetente, m.texto, m.transcricao, m.tipo, m.enviada_em
    from public.mensagens m where m.conversa_id = c.id order by m.enviada_em desc limit 1
  ) u
  cross join lateral (select right(regexp_replace(coalesce(c.telefone, c.contato), '\D', '', 'g'), 8) as tel) t
  where c.org_id = p_org
    and c.data between p_from and p_to
    and c.canal <> 'importada'
    and u.remetente = 'cliente'
    and u.enviada_em < now() - make_interval(mins => p_min)
    -- alguem da equipe ja respondeu esse cliente depois (outro vendedor, outro numero ou outra conversa): nao esta sem retorno
    and not exists (
      select 1 from public.conversas c2 join public.mensagens m2 on m2.conversa_id = c2.id
      where c2.id <> c.id and c2.org_id = c.org_id and m2.remetente = 'vendedor' and m2.enviada_em > u.enviada_em
        and right(regexp_replace(coalesce(c2.telefone, c2.contato), '\D', '', 'g'), 8) = t.tel)
    -- respondido pelo CRM depois da ultima mensagem do cliente
    and not exists (
      select 1 from public.crm_conversas cc join public.crm_mensagens cm on cm.conversa_id = cc.id
      where cc.org_id = c.org_id and right(regexp_replace(cc.telefone, '\D', '', 'g'), 8) = t.tel
        and cm.direcao = 'outbound' and not coalesce(cm.nota_interna, false) and not coalesce(cm.automatica, false)
        and cm.apagada_em is null and cm.enviada_em > u.enviada_em)
    -- ligacao ATENDIDA (feita ou recebida) depois da ultima mensagem do cliente conta como retorno (pedido da gestao, 25/11/2026)
    and not exists (
      select 1 from public.ligacoes l
      where l.org_id = c.org_id and l.atendida and right(regexp_replace(l.contato, '\D', '', 'g'), 8) = t.tel
        and l.iniciada_em > u.enviada_em)
    -- cliente em Perdido ou Ganho no CRM, ou com a conversa encerrada no CRM (closed/resolved): o CRM manda so "closed"
    -- quando o cartao vai para Perdido/Ganho e a conversa e encerrada junto (pedido da gestao, 25/11/2026)
    and not exists (
      select 1 from public.crm_conversas cc
      where cc.org_id = c.org_id and right(regexp_replace(cc.telefone, '\D', '', 'g'), 8) = t.tel
        and (cc.status ~ '_(perdido|ganho)$' or cc.status in ('closed', 'resolved')))
  order by u.enviada_em
  limit 500
$$;
revoke all on function public.conversas_sem_retorno_org(uuid, date, date, integer) from public, anon;
grant execute on function public.conversas_sem_retorno_org(uuid, date, date, integer) to service_role;
