# Conexão com o WhatsApp

Como o sistema de Auditoria Comercial conecta o WhatsApp de cada SDR, grava as conversas e mostra o QR Code no painel.

Atualizado em 16/10/2026.

## Resumo

- A conexão é feita pela **Uazapi** (uazapiGO v2). Ela mantém a sessão do WhatsApp de cada SDR nos servidores dela, gera o QR Code e avisa o sistema a cada mensagem por **webhook**.
- Não é a API oficial do WhatsApp (Meta): continua sendo uma conexão por QR Code, como o WhatsApp Web.
- Quem conversa com a Uazapi é o **worker**, a Edge Function `worker` do **Supabase**, chamada pelo webhook e por relógios do banco (pg_cron). O site (Vercel) não fala com a Uazapi: ele só lê e escreve no banco (Supabase).
- O código antigo com o **Baileys** (conexão direta, sem Uazapi) continua no projeto como alternativa. Ele só é usado se a variável `UAZAPI_URL` estiver vazia.

```
Celular do SDR ──(QR Code)──► UAZAPI (sessão do WhatsApp)
                                 │  ▲
             webhook a cada      │  │  criar instância, pedir QR,
             mensagem            ▼  │  status, desconectar, baixar áudio
                         WORKER (Edge Function)
                                 │  grava mensagens, áudios, QR e status
                                 ▼
                       Supabase (banco + Storage)
                                 ▲
                                 │  lê QR e status, envia comandos
                   SITE na Vercel (tela WhatsApp)
```

## Onde fica cada peça

| Peça | Onde | Arquivo |
|---|---|---|
| Conversa com a Uazapi (instâncias, QR, status, webhook) | Worker (Edge Function) | `worker/src/uazapi.js` |
| Gravação das mensagens no banco (comum aos dois provedores) | Worker (Edge Function) | `worker/src/mensagens.js` |
| Rotas do webhook e dos relógios, sinal de vida | Worker (Edge Function) | `worker/src/edge.js` |
| Conexão direta pelo Baileys (alternativa, servidor Node próprio) | Worker | `worker/src/whatsapp.js` |
| Tela "WhatsApp conectado" e desenho do QR | Site (Vercel) | `web/src/app/(app)/instancias/` |
| Conexões (`instancias_whatsapp`), conversas, mensagens, sinal de vida | Supabase | `supabase/schema.sql` |
| Token de cada instância na Uazapi (`instancias_uazapi`) | Supabase, só o worker lê | `supabase/schema.sql` |
| Teste da integração com a Uazapi simulada | Worker | `worker/test/uazapi.js` |

## Variáveis do worker (Supabase → Edge Functions → Secrets)

| Variável | O que é | Segredo? |
|---|---|---|
| `UAZAPI_URL` | Endereço do servidor da Uazapi, por exemplo `https://suaempresa.uazapi.com` | Não |
| `UAZAPI_ADMIN_TOKEN` | `admintoken` do painel da Uazapi (cria e lista instâncias) | **Sim** |
| `WEBHOOK_URL` | `https://<projeto>.supabase.co/functions/v1/worker`, para onde a Uazapi manda as mensagens | Não |
| `WEBHOOK_SECRET` | Segredo que vai na URL do webhook; sem ele o worker recusa a chamada | **Sim** |

## Passo a passo de uma conexão

1. **O admin cria a conexão** na tela WhatsApp do site (vendedor e nome). O site grava uma linha em `instancias_whatsapp` com status `aguardando`.
2. **O worker cria a instância na Uazapi** (`POST /instance/create`, com o `admintoken`), com o nome `auditoria-<id da conexão>`. O token que a Uazapi devolve fica em `instancias_uazapi`.
3. **O worker configura o webhook** da instância (`POST /webhook`): eventos `messages`, `connection` e `call`, grupos excluídos, endereço `WEBHOOK_URL/webhook/uazapi?k=WEBHOOK_SECRET`.
4. **O worker pede o QR** (`POST /instance/connect`, sem telefone) e, a cada minuto, consulta `GET /instance/status`. O QR vem como imagem em base64 e é gravado na coluna `qr` com status `aguardando_qr`.
5. **O site mostra o QR.** A tela WhatsApp se atualiza a cada 5 segundos.
6. **O SDR lê o QR no celular:** WhatsApp > Aparelhos conectados > Conectar um aparelho.
7. **Conectado.** O status da Uazapi passa a `connected`; o worker grava `conectado`, apaga o QR e salva o número.
8. **QR expirado ou desconexão:** o QR da Uazapi vale 2 minutos. Se a instância voltar a `disconnected` (QR não lido, ou o SDR desconectou pelo celular), o worker pede um QR novo sozinho, no máximo a cada 2 minutos.

### Situações de cada conexão (`instancias_whatsapp.status`)

| Status | O que aparece na tela | Status na Uazapi |
|---|---|---|
| `aguardando` | Criando a conexão... | instância ainda não criada |
| `conectando` | Conectando... | `connecting`, ainda sem QR |
| `aguardando_qr` | Aguardando leitura do QR Code | `connecting`, com QR |
| `conectado` | Conectado | `connected` |
| `desconectado` | Desconectado | `disconnected` depois de ter conectado |
| `erro` | Erro ao conectar | falha ao pedir conexão (por exemplo, limite de conexões do plano, HTTP 429) |

### Botões da tela (só admin)

- **Desconectar e gerar novo QR:** grava `comando = 'reset'`. O worker chama `POST /instance/disconnect`, depois `POST /instance/connect`, e o QR novo aparece na tela.
- **Remover:** apaga a conexão. No ciclo seguinte o worker lista as instâncias da Uazapi (`GET /instance/all`) e apaga (`DELETE /instance`) as que começam com `auditoria-` e não existem mais no banco.

## O que é gravado

A cada mensagem nova, a Uazapi chama o webhook do worker. O worker:

1. Confere o segredo da URL. Sem ele, responde 401.
2. Identifica a conexão pelo `token` que vem no corpo do webhook (comparando com `instancias_uazapi`). Token desconhecido é ignorado.
3. Ignora grupos e eventos que não são `messages`.
4. Grava em `conversas` e `mensagens`, igual ao que já era feito antes:
   - **Uma conversa por contato por dia** (fuso de São Paulo). O contato é o número do lead, mesmo nas mensagens enviadas pelo SDR. Em conversas no formato `@lid`, o número vem de `chat.wa_chatid` ou `sender_pn`.
   - **Remetente:** `fromMe` = vendedor; o resto = cliente.
   - **Tipo:** texto, áudio, imagem, vídeo, documento ou outro, a partir de `messageType`.
   - **Mensagens repetidas** são ignoradas pelo `messageid`.
5. **Áudios dos últimos 2 dias** são baixados pela Uazapi (`POST /message/download`, em OGG) e guardados no bucket privado `audios`. O worker transcreve com o Whisper depois.

O filtro opcional `LEAD_ALLOWLIST` continua valendo.

## Sinal de vida do worker

A cada minuto o worker grava a hora em `worker_status`. A tela WhatsApp mostra "Worker ligado" (verde) ou "Worker desligado: o QR Code não vai aparecer" (aviso dourado).

## Segurança

- O `admintoken` e os tokens das instâncias **nunca vão para o navegador**: ficam nos segredos da Edge Function e na tabela `instancias_uazapi`, que só o worker lê.
- O webhook só aceita chamadas com o `WEBHOOK_SECRET` na URL e com um token de instância conhecido.

## Riscos e limites

- **Não é a API oficial.** O WhatsApp pode restringir números com comportamento de disparo em massa.
- **Custo e limite de conexões** dependem do plano contratado na Uazapi. O servidor gratuito (`free.uazapi.com`) desconecta as instâncias automaticamente e não serve para uso real.
- **Ligações não passam por aqui.** Elas entram pelo envio da gravação na tela Ligações.
- **LGPD:** as conversas passam pelos servidores da Uazapi e ficam guardadas no Supabase.

## Fonte

Rotas, campos e formato do webhook conferidos na especificação OpenAPI da uazapiGO 2.0.1 (arquivo publicado no projeto aberto `jonesfernandess/uazapi-cli`) e no exemplo de webhook do projeto `urzum/n8n-nodes-uazapi`. A documentação oficial fica em docs.uazapi.com.
