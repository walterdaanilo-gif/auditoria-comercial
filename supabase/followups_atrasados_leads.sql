-- Lista dos follow-ups atrasados no retrato da TV: clicar no quadro "Follow-ups atrasados" do vendedor mostra quem sao.
-- O worker (worker/src/followup.js, fotografarFollowups) grava em "leads" um item por cliente:
--   { "nome": "...", "desde": "<ultima mensagem do time, ou do cliente se nunca respondido>", "dias": 8, "sem_resposta": false }
-- Sem esta coluna o worker continua gravando so a quantidade (a TV mostra o numero, sem a lista).
alter table public.followups_atrasados add column if not exists leads jsonb;
