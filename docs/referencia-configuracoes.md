# Referência: Configurações da auditoria

Origem: tela de configurações de um auditor de conversas de referência (dados de demonstração). Capturado em 17/10/2026.
Uso: arquivo de referência para o Claude Code (salvar em docs/referencia-configuracoes.md). Usar as ideias, sem copiar marca nem textos literais.

---

## 1. Estrutura geral da tela

- Título: **Configurações da auditoria**. Subtítulo: "Tipo de auditoria por número, frequência da auditoria automática, auditoria ao fechar e alerta WhatsApp ao gestor."
- **Barra de progresso de onboarding**: "Configuração do Auditor · 83% · Nível: Avançado · 10 de 12 passos · Próximo passo: Auditoria automática". Cada card concluído ganha check verde; o pendente mostra ícone de alerta e selo "Recomendado".
- Cards em **acordeão** (cada um abre/fecha), com título + resumo de uma linha do estado atual (ex.: "Apenas individuais · 4+ msgs · amostra 100%").
- 3 blocos:
  1. **Configuração essencial** (8 cards)
  2. **Funil de vendas** (1 card)
  3. **Avançado · Modo Pro** (3 cards)
- Rodapé fixo: botões **Descartar** e **Salvar** (salvamento em lote, não por campo).
- Ícones no topo direito: engrenagem (configurações) e plugue (conexões).

---

## 2. Configuração essencial

### 2.1 Auditoria automática
- Toggle on/off. Estado na demo: **desligada** ("roda só quando você pede").
- Texto: o Auditor revisa as conversas sozinho e avisa quando algo precisa de atenção (oportunidades, riscos, pontos de melhoria). Desligado, só revisa quando o usuário pede manualmente.

### 2.2 Quais conversas auditar
- **Tipo de conversa** (seleção única):
  - Individuais + grupos (audita tudo)
  - Apenas individuais (conversas 1 a 1) ← selecionado
  - Apenas grupos
- Regra de negócio exibida: o Auditor avalia só a conversa entre atendente humano e cliente. Mensagens automáticas, assistente de IA, chatbot, menu eletrônico e respostas automáticas (inclusive de bots de terceiros) são reconhecidas e **desconsideradas na nota**. Se a conversa foi 100% bot, ele aponta isso em vez de pontuar o bot.
- **Mínimo de mensagens** para auditar: toggle "Padrão do app" (4 msgs). Desligar o padrão permite valor próprio da organização.
- **Amostragem** (% das conversas elegíveis): toggle "Padrão do app" (100%). Mesma lógica de override por organização.
- Texto de apoio: "A cada rodada, o Auditor audita 100% das conversas com 4+ mensagens, sorteadas por número conectado. Menos amostra e mais mensagens = menos crédito gasto."
- **Só conversas com orçamento** (toggle): audita só quem já tem lead em etapa de proposta/orçamento. Foca o crédito nas negociações.

> Ideia-chave: modelo de **créditos por auditoria**, e a configuração existe para controlar custo de IA.

### 2.3 Tipo de auditoria por número
- Cada número de WhatsApp conectado recebe um tipo de rubrica:
  - **Vendas**: avalia abordagem comercial e oportunidades.
  - **Sucesso do cliente (pós-venda)**: avalia resolução, agilidade e relacionamento.
- Demo: 5 números (Amanda, Bruno, Carla, Diego = Vendas; Elaine = Sucesso do cliente). Lista mostra nome do atendente, telefone e seletor de tipo.

### 2.4 Números ignorados
- Lista de telefones que **não** devem ser auditados (chefe, colega, fornecedor). Campo: "55 + DDD + número, Enter pra adicionar".
- Vale para auditoria automática e auditoria ao fechar. Ainda dá para auditar manualmente pelo botão "Auditar agora" na conversa.

### 2.5 Alertas ao gestor
- **WhatsApp (até 3 números)**: recebem o resumo diário e os avisos marcados. Campo "Outro número…" + Enter.
- **Quando avisar no WhatsApp** (checkbox):
  - Venda detectada (venda fechada identificada na conversa)
  - Oportunidade (interesse comercial claro, mesmo sem fechar)
  - Sem nada marcado: WhatsApp recebe só o resumo diário; tudo continua como notificação no app.
- **Formato da mensagem**: Resumido (direto ao ponto) ou Detalhado (com contexto e link). Com preview ao vivo:

```
💰 [Seu sistema] Venda detectada na conversa com Maria Silva
Organização: Sua empresa
Cliente confirmou a compra do plano Pro e enviou o comprovante de pagamento.
💵 Valor: R$ 2.450,00
Ver auditoria: <link da auditoria>

🎯 [Seu sistema] Oportunidade na conversa com Maria Silva
Organização: Sua empresa
Cliente pediu orçamento do plano anual e quer marcar uma demonstração esta semana.
Ver auditoria: <link da auditoria>
```

- Regras: cada conversa gera **só uma mensagem** (a do evento mais urgente). Venda e oportunidade só avisam em conversas **recém-encerradas** (não na varredura em lote). Alerta crítico e ponto importante **não vão para o WhatsApp**: chegam como notificação no app, para o gestor e para o responsável pela conversa.

### 2.6 Alerta crítico & SLA
- **O que é CRÍTICO no seu negócio**: textarea, uma situação por linha, com chips de sugestão clicáveis (✓ = já adicionada, + = disponível):
  - ✓ Cliente ameaçou cancelar ou rescindir
  - \+ Cliente pediu pra falar com advogado
  - ✓ Atendente prometeu prazo que não cumprimos
  - \+ Erro em valor cobrado / cobrança duplicada
  - \+ Cliente sem resposta há mais de 1 dia útil
  - \+ Pedido de urgência médica / segurança
  - ✓ Menção a Procon ou reclamação pública
- Valor salvo na demo:
  - Cliente informou que ia acionar a justiça ou falar com advogado
  - Atendente prometeu prazo que não cumprimos
  - Menção a Procon ou reclamação pública
  - Cliente ameaçou cancelar ou rescindir
- Vazio = só a **régua padrão** do Auditor (cliente furioso prestes a sair, conduta grave, risco jurídico, venda grande sendo perdida agora). Regras do cliente **complementam** a régua padrão, não substituem.
- **SLA de primeira resposta**: unidade Minutos/Horas + número. Demo: "1ª resposta em até 15 min". Alimenta o "% no SLA" do dashboard e vira critério de agilidade na auditoria.
- Alerta crítico chega como notificação no app + push.

### 2.7 Cadência de follow-up
- Define quando o lead vira "Sem resposta" e "Abandonada" no funil, e a base da **taxa de abandono por atendente**. Modo: Personalizado.
  - **Sem resposta após** 24 horas comerciais (bola parada com o vendedor)
  - **Abandonada após** 3 dias (oportunidade quente sem retorno)
  - **Deixa de contar após** 14 dias (teto de recuperabilidade)

### 2.8 Horário de funcionamento
- Faz a espera por 1ª resposta e o SLA contarem só o tempo dentro do expediente (não penaliza mensagem de madrugada/fim de semana).
- Origem do horário (seleção única): Desligado (mede 24h corridas) ← demo · Da organização (um horário para tudo) · Por número (cada loja o seu).

### 2.9 Resumo diário no WhatsApp
- Toggle ligado. Resumo consolidado para os mesmos telefones dos alertas. É o **report principal** do Auditor.
- Horário (BRT): 07:00 início do dia · 12:00 almoço · **19:00 fim do expediente** (demo) · 21:00 noite.
- Dias da semana: Seg a Dom (demo: 5 dias, seg a sex). Dias sem resumo acumulam no próximo envio.
- Preview:

```
📊 Resumo do Auditor: Sua Empresa
(últimas 24h)
✅ Auditorias: 12
⭐ Score médio: ⭐⭐⭐⭐☆ (4.20)
⏱️ Tempo médio de resposta: 3min 24s
💰 Vendas detectadas: 3 · R$ 2.450,00
🎯 Oportunidades: 5
🏆 Ranking
1. Adriana: ⭐ 4.6 · 2 vendas (R$ 1.650,00)
2. João: ⭐ 4.3 · 1 venda (R$ 800,00)
3. Marina: ⭐ 4.0
```

---

## 3. Funil de vendas

### 3.1 Criar leads no funil automaticamente
Quando a auditoria identifica oportunidade ou venda, cria o lead (se não existir) e move para o estágio certo. Vem ligado por padrão.
- **Ao detectar oportunidade**: Automático (o sistema escolhe o estágio) · Escolher estágio · Desligado. Demo: detectado automaticamente "ARQUITETO/DESIGNER · Funil principal".
- **Ao detectar venda fechada**: marca o lead como ganho (avisa o responsável) ou cria lead ganho com o valor da venda. Mesmas 3 opções. Demo: "ORÇAMENTO FECHADO · Funil principal". Desligado, a venda só fica ligada ao lead, sem mover o card.

---

## 4. Avançado · Modo Pro

### 4.1 Critérios de avaliação (rubrica)
- Opções: **Padrão do sistema** (rubrica pronta, recomendada, diferente por tipo Vendas/Sucesso) ou **Personalizados**.
- Aviso: personalizados valem para todas as conexões, sem distinguir Vendas de Sucesso do cliente.
- Cada critério vira nota **1 a 5** por conversa; o **peso** define quanto vale na nota final. Barra visual de composição. Cada critério tem toggle ativo/inativo e é editável. Campo "Adicionar novo critério".
- Demo: 11 critérios ativos (soma 101% por arredondamento):

| Critério | Peso | Definição |
|---|---|---|
| Abordagem e acolhimento | 7% | Saudação, apresentação, receptividade e tom cordial e profissional do começo ao fim. |
| Resolução do problema | 13% | Problema/dúvida resolvido, ou encaminhado com próximo passo e prazo claros. |
| Qualificação da necessidade | 10% | Entende a necessidade antes de ofertar: perguntas qualificadoras e oferta adaptada. |
| Agilidade no atendimento | 8% | Rapidez da 1ª resposta e continuidade sem deixar o cliente esperando. |
| Empatia e acolhimento | 10% | Escuta ativa, validação do sentimento, tom acolhedor diante de frustração. |
| Objetividade e clareza | 7% | Respostas diretas e completas: preço, condições e informações sem rodeios. |
| Clareza nas respostas | 7% | Claras, completas, fáceis de entender, sem jargão. |
| Tratamento de objeções | 8% | Responde objeções (preço, prazo, concorrente, dúvidas) com argumentos, sem evasivas. |
| Condução ao fechamento | 13% | Identifica oportunidade, propõe próximo passo concreto e tenta fechar. |
| Proatividade e retenção | 10% | Antecipa necessidades, confirma satisfação, cuida da relação. |
| Follow-up | 8% | Retoma o contato quando o cliente esfria ou some. |

> Observação: há sobreposição (Abordagem x Empatia; Objetividade x Clareza). No novo projeto vale fundir.

### 4.2 Detecção de vendas
- Padrão: cliente confirma a compra, envia comprovante ou aceita explicitamente a proposta.
- **O que CONTA** (sugestões): Cliente confirmou a compra · ✓ Enviou comprovante de pagamento · Aceitou a proposta enviada · Pediu pra emitir nota fiscal · Marcou data de instalação/entrega · Assinou o contrato · Pagou sinal/entrada.
  - Salvo na demo: Enviou comprovante de pagamento; Enviou print do pedido finalizado no site.
- **O que NÃO conta**: ✓ Cliente disse "vou pensar" · ✓ Pediu desconto e não respondeu · Reservou sem pagar · Renovação automática de cliente ativo · ✓ Pagamento prometido mas não confirmado · Demonstração de interesse sem acordo.
- Finalidade: não inflar o número de vendas no painel.

### 4.3 Detecção de oportunidades
- Padrão: cliente pergunta preço, prazo, orçamento, quer marcar reunião.
- **O que CONTA**: Pediu tabela de preços · Perguntou prazo de entrega · ✓ Pediu orçamento · Quer marcar reunião/demo · Mencionou orçamento aprovado · Comparou com concorrente · ✓ Pediu condição de pagamento.
  - Salvo na demo: Pediu orçamento; Pediu condição de pagamento; Descreveu medidas ou especificidades; Informou CEP para simulação de frete/entrega.
- **O que NÃO conta**: Suporte técnico de cliente ativo · Pesquisa acadêmica/TCC · ✓ Curiosidade ("quanto custa?" sem intenção) · Currículo/proposta de trabalho · Spam ou bot · Conversa pessoal sem contexto comercial · ✓ Reclamação sem intenção de comprar de novo.
- Finalidade: reduzir falsos positivos no funil.

---

## 5. Padrões de produto que valem copiar

1. **Onboarding com % e "próximo passo"**: transforma configuração em checklist com nível (Básico, Avançado).
2. **Resumo do estado no card fechado**: o gestor lê a configuração inteira sem abrir nada.
3. **Padrão do app + override por organização** em cada parâmetro numérico.
4. **Regras em linguagem natural** (textarea, uma por linha) + chips de sugestão. Viram contexto no prompt da IA, sem precisar de motor de regras.
5. **Régua padrão + regras do cliente que complementam** (nunca substituem).
6. **Separar canais por urgência**: WhatsApp para resumo e venda/oportunidade; crítico só no app/push, para gestor e responsável.
7. **Uma mensagem por conversa**, a do evento mais urgente (evita spam no WhatsApp do gestor).
8. **Controle de custo de IA** via amostragem, mínimo de mensagens e "só quem tem orçamento".
9. **Filtro de bot**: não pontuar mensagens automáticas; sinalizar conversa 100% bot.
10. **Rubrica por tipo de número** (Vendas x Pós-venda) com pesos e nota 1 a 5.
11. **SLA e horário comercial** ligados ao dashboard e à nota de agilidade.
12. **Auditoria alimenta o CRM**: cria/move lead e marca ganho com valor.

---

## 6. Esboço de modelo de dados (Supabase) para o novo projeto

```sql
-- configuração por organização (1 linha por org)
create table audit_settings (
  org_id uuid primary key references orgs(id),
  auto_audit_enabled boolean default false,
  conversation_scope text check (conversation_scope in ('all','individual','group')) default 'individual',
  min_messages int,               -- null = padrão do app (4)
  sample_pct int,                 -- null = padrão do app (100)
  only_with_quote boolean default false,
  critical_rules text[],          -- uma situação por item
  sla_first_response_minutes int default 15,
  followup_no_reply_hours int default 24,
  followup_abandoned_days int default 3,
  followup_stop_days int default 14,
  business_hours_mode text check (business_hours_mode in ('off','org','per_number')) default 'off',
  daily_summary_enabled boolean default true,
  daily_summary_time time default '19:00',
  daily_summary_days int[] default '{1,2,3,4,5}',
  alert_on_sale boolean default false,
  alert_on_opportunity boolean default false,
  alert_format text check (alert_format in ('short','detailed')) default 'detailed',
  crm_on_opportunity text check (crm_on_opportunity in ('auto','stage','off')) default 'auto',
  crm_opportunity_stage_id uuid,
  crm_on_sale text check (crm_on_sale in ('auto','stage','off')) default 'auto',
  crm_sale_stage_id uuid,
  rubric_mode text check (rubric_mode in ('system','custom')) default 'system',
  sale_include_rules text[],
  sale_exclude_rules text[],
  opp_include_rules text[],
  opp_exclude_rules text[],
  updated_at timestamptz default now()
);

create table connected_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  seller_id uuid references profiles(id),
  phone text not null,
  audit_type text check (audit_type in ('sales','customer_success')) default 'sales',
  business_hours jsonb             -- usado quando business_hours_mode = 'per_number'
);

create table ignored_numbers (org_id uuid, phone text, primary key (org_id, phone));
create table manager_alert_phones (org_id uuid, phone text, primary key (org_id, phone)); -- máx 3

create table rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  name text, description text,
  weight numeric,                  -- soma = 100
  active boolean default true,
  position int
);
```
