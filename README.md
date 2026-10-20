# Auditoria Comercial

Sistema de auditoria das conversas de WhatsApp e das ligações do time comercial. O WhatsApp de cada vendedor é conectado por QR Code, as conversas são gravadas no Supabase, os áudios são transcritos e a IA dá nota a cada conversa e ligação. O painel mostra tudo por perfil de acesso, e a planilha do Google continua recebendo os números para o dash atual.

```
WhatsApp (QR Code) ─┐
                    ├─► WORKER (servidor 24h) ─► Supabase (banco, login, áudios) ◄─ SITE Next.js (Vercel)
Gravação de ligação ┘        │  transcreve (Whisper) e audita (Claude)
                             └─► Planilha do Google (espelho) ─► dash da TV
```

| Pasta | O que é | Onde roda |
|---|---|---|
| `supabase/schema.sql` | Tabelas, RLS, bucket de áudios, funções | SQL Editor do Supabase (uma vez) |
| `web/` | Site: login, painel, conversas, ligações, WhatsApp, usuários, roteiro | Vercel (grátis) |
| `worker/` | Webhook da Uazapi, transcrição, auditoria, resumos, agenda, CRM | Edge Function `worker` do Supabase (grátis) |

**Sem servidor ligado 24h:** a sessão do WhatsApp fica na Uazapi, que avisa cada mensagem por webhook. O resto roda por relógios do banco (pg_cron), que chamam a Edge Function.

---

## 1. Supabase

1. Crie o projeto em supabase.com (região São Paulo, se houver).
2. **SQL Editor** → New query → cole todo o `supabase/schema.sql` → Run. Ele cria:
   - Tabelas `profiles`, `instancias_whatsapp`, `conversas`, `mensagens`, `ligacoes`, `auditorias`, `config_auditoria` (roteiro) e `analises_time`.
   - RLS em todas: o vendedor vê só os próprios dados, gestor e admin veem tudo. Só o admin altera usuários, conexões e roteiro.
   - Bucket privado `audios` com RLS: cada vendedor só lê e envia na própria pasta, gestor e admin leem tudo.
   - A função `resumo_por_vendedor`, que respeita a RLS.
3. **Desligue o cadastro público:** Authentication → Sign In / Providers → desligue **Allow new users to sign up** (em algumas versões do painel fica em Providers → Email, com o nome **Enable sign ups**). O admin continua criando usuários pelo painel.
4. **URLs do login:** Authentication → URL Configuration
   - Site URL: `https://auditoria-comercial-omega.vercel.app`
   - Redirect URLs: `https://auditoria-comercial-omega.vercel.app/auth/callback`
5. **Primeiro admin:** Authentication → Users → Add user (e-mail, senha, marque Auto Confirm). Depois, no SQL Editor:
   ```sql
   update public.profiles set papel = 'admin', nome = 'Seu nome' where email = 'voce@empresa.com';
   ```
6. **E-mail de recuperação de senha:** o e-mail padrão do Supabase tem limite baixo de envios por hora. Para produção, configure um SMTP próprio em Authentication → Emails → SMTP Settings (ex.: Resend, Brevo).

## 2. Variáveis de ambiente

No Supabase, a URL fica no botão **Connect** (topo do painel) ou em **Project Settings → Data API**, e as chaves em **Project Settings → API Keys**.

O Supabase está trocando as chaves antigas (`anon` e `service_role`, que começam com `eyJ`) pelas novas (`sb_publishable_...` e `sb_secret_...`). Projeto novo usa as novas. O sistema aceita as duas: a publishable entra no lugar da anon, e a secret no lugar da service_role, com os mesmos nomes de variável.

| Variável | Onde pegar | Onde colocar | Pode ir para o navegador? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Vercel | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key (ou a `anon` legada) | Vercel | Sim (a RLS protege) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (ou a `service_role` legada) | Vercel **e** worker | **NUNCA** |
| `NEXT_PUBLIC_SITE_URL` | o endereço do site | Vercel | Sim |
| `SUPABASE_URL` | Project URL (o mesmo) | worker | Não se aplica |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | worker | **NUNCA** |
| `TRANSCRIBE_API_KEY` | platform.openai.com → API keys (Whisper) | worker | **NUNCA** |
| `GOOGLE_SERVICE_ACCOUNT_FILE` + `SHEET_ID` | conta de serviço do Google (espelho) | worker | **NUNCA** |

Regras da service_role key:
- Na Vercel ela **não** leva `NEXT_PUBLIC_`. Só `src/lib/supabase/admin.ts` a usa, e só dentro de Server Actions que começam por `exigirAdmin()`.
- Ela ignora a RLS. Se vazar, gere outra no Supabase na hora.
- Nunca commite `.env` (os `.gitignore` já bloqueiam).

## 3. Site na Vercel (plano gratuito)

1. Suba esta pasta para um repositório no GitHub (privado).
2. vercel.com → Add New → Project → importe o repositório.
3. **Root Directory:** `web`. Framework: Next.js (detecta sozinho).
4. **Project Name:** `auditoria-comercial`. O endereço fica `auditoria-comercial-omega.vercel.app`. Se o nome já existir, a Vercel sugere outro. Atualize então as URLs do passo 1.4.
5. Environment Variables: as 4 da tabela marcadas como Vercel.
6. Deploy.

Login, recuperação de senha e logout já estão prontos. Todas as rotas passam pelo `middleware.ts`: sem login, vai para `/login`.

## 4. Worker (WhatsApp, transcrição e auditoria)

Roda como **Edge Function `worker` do Supabase** (`worker/src/edge.js` é a entrada), com o WhatsApp pela **Uazapi**:
- `POST /functions/v1/worker/webhook/uazapi?k=<WEBHOOK_SECRET>`: mensagens que a Uazapi manda na hora.
- `POST /functions/v1/worker/tick?t=rapido|ciclo|crm`: chamado pelo pg_cron (`select public.worker_disparar('rapido')`) a cada 1, 5 e 15 min, com a chave interna da tabela `worker_token`.

Segredos em Supabase → Edge Functions → Secrets: `UAZAPI_URL`, `UAZAPI_ADMIN_TOKEN`, `WEBHOOK_URL` (`https://<projeto>.supabase.co/functions/v1/worker`), `WEBHOOK_SECRET`, `TRANSCRIBE_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase já injeta.

O modo antigo (Node com Baileys, `worker/src/index.js`) continua no código como alternativa para servidor próprio.

O que o worker faz:
- A cada 15 s, lê as conexões criadas no painel, sobe as novas, aplica "gerar novo QR" e derruba as removidas.
- Grava cada mensagem e a conversa do dia. Grupos e status são ignorados.
- Baixa os áudios do WhatsApp para o Storage. A cada 20 s, transcreve áudios e gravações de ligações com o Whisper.
- A cada 5 min, audita as conversas paradas há 20 min. Se a conversa ganha mensagens, ela é reauditada. Ligações transcritas também são auditadas.
- Gera a análise comercial do time quando alguém pede no painel, e uma vez por dia depois das 20h.
- A cada 30 s, espelha na planilha: abas Mensagens, Auditoria e as colunas D, G, H, I e K da aba SDR, que o dash da TV lê.

## 5. Uso no dia a dia

1. **Admin → Usuários:** crie os usuários (nome, e-mail, senha inicial, papel). Também dá para editar, desativar (bloqueia o login na hora) e redefinir senha.
2. **WhatsApp:** o admin cria uma conexão para cada vendedor. O QR aparece no card. O vendedor lê no celular em Aparelhos conectados → Conectar um aparelho.
3. **Ligações:** o vendedor envia a gravação. O sistema transcreve e audita.
4. **Roteiro (admin):** é a régua da nota. Edite com o roteiro real do convite.
5. **Painel:** volumes, nota média, qualidade, gatilhos comerciais, etapas, objeções e a análise do time. Atualiza sozinho a cada 30 s.

| Papel | Vê | Pode |
|---|---|---|
| Vendedor | só as próprias conversas, ligações e notas | enviar as próprias ligações |
| Gestor | tudo | pedir análise do time, ver conexões |
| Admin | tudo | usuários, conexões, roteiro |

## 6. Pontos de atenção

- **WhatsApp por QR Code não é a API oficial.** O WhatsApp pode restringir números com comportamento de disparo em massa. Mensagens personalizadas e em ritmo humano.
- **O WhatsApp não grava ligações.** Elas entram pelo envio da gravação na tela Ligações.
- Áudios do histórico com mais de 2 dias não são baixados, só os novos.
- **LGPD:** o sistema guarda conversas e áudios de clientes. Avise os leads, defina por quanto tempo guardar e restrinja o acesso de admin.
- Os nomes dos usuários (Ruan, Nick) precisam ser iguais aos da coluna SDR da planilha para o espelho achar a linha certa.

## 7. Testes

- Worker: `cd worker && npm install && npm test` (gravação, transcrição, auditoria, reauditoria, métricas, análise e espelho, com serviços simulados).
- Site: `cd web && npm install && npm run build`. Rode isso antes do primeiro deploy, para pegar qualquer erro de tipo.
