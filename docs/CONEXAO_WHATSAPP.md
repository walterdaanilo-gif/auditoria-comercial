# Conexão com o WhatsApp

Como o sistema de Auditoria Comercial conecta o WhatsApp de cada SDR, grava as conversas e mostra o QR Code no painel.

Atualizado em 16/10/2026.

## Resumo

- **Não usamos a Uazapi** nem nenhum outro serviço intermediário. Também não é a API oficial do WhatsApp (Meta).
- A conexão é feita pelo **Baileys** (`@whiskeysockets/baileys`, versão 6.7.x), uma biblioteca de código aberto que se conecta ao WhatsApp do mesmo jeito que o **WhatsApp Web**: o SDR lê um QR Code e o sistema vira um "aparelho conectado" no celular dele.
- Quem roda o Baileys é o **worker**, um programa Node.js ligado 24h no **Railway**. O site (Vercel) não conecta no WhatsApp: ele só lê e escreve no banco (Supabase).
- Worker e site conversam **só pelo banco**. Não há chamada direta entre eles.

```
Celular do SDR ──(QR Code / WhatsApp Web)──► WORKER no Railway (Baileys)
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
| Conexão com o WhatsApp | Worker (Railway) | `worker/src/whatsapp.js` |
| Laço principal e sinal de vida | Worker (Railway) | `worker/src/index.js` |
| Cliente do banco usado pelo worker | Worker (Railway) | `worker/src/supa.js` |
| Tela "WhatsApp conectado" | Site (Vercel) | `web/src/app/(app)/instancias/page.tsx` |
| Desenho do QR Code na tela | Site (Vercel) | `web/src/app/(app)/instancias/QrCard.tsx` |
| Tabelas `instancias_whatsapp`, `conversas`, `mensagens`, `worker_status` | Supabase | `supabase/schema.sql` |
| Sessões do WhatsApp (login de cada aparelho) | Disco permanente do Railway | `/app/data/auth/<id da conexão>/` |

## Passo a passo de uma conexão

1. **O admin cria a conexão** na tela WhatsApp do site (vendedor e nome, por exemplo "WhatsApp do Ruan"). O site grava uma linha em `instancias_whatsapp` com status `aguardando`.
2. **O worker percebe a conexão nova.** A cada 15 segundos ele lê a tabela `instancias_whatsapp` (`syncInstances`) e, para cada linha que ainda não está rodando, abre uma conexão Baileys (`startInstance`).
3. **O Baileys gera o QR Code.** O worker grava o texto do QR na coluna `qr` e muda o status para `aguardando_qr`.
4. **O site mostra o QR.** A tela WhatsApp se atualiza sozinha a cada 5 segundos e desenha o QR a partir do texto (biblioteca `qrcode`). O QR expira e é renovado sozinho pelo WhatsApp; a tela acompanha.
5. **O SDR lê o QR no celular:** WhatsApp > Aparelhos conectados > Conectar um aparelho.
6. **Conectado.** O worker grava status `conectado`, apaga o QR e salva o número. As credenciais da sessão ficam no disco permanente (`/app/data/auth/<id>/`), então o worker religa sozinho depois de reinícios, sem ler o QR de novo.

### Situações de cada conexão (`instancias_whatsapp.status`)

| Status | O que aparece na tela | O que significa |
|---|---|---|
| `aguardando` | Aguardando o worker | Conexão criada, o worker ainda não pegou |
| `conectando` | Conectando... | Worker abrindo a conexão ou reconectando |
| `aguardando_qr` | Aguardando leitura do QR Code | QR na tela, esperando o SDR ler |
| `conectado` | Conectado | Funcionando, mensagens entrando |
| `desconectado` | Desconectado | O SDR desconectou pelo celular; o worker apaga a sessão e gera QR novo |
| `erro` | Erro | Falha ao abrir a conexão (ver registros do Railway) |

### Botões da tela (só admin)

- **Desconectar e gerar novo QR:** grava `comando = 'reset'`. No próximo ciclo o worker faz logout, apaga a sessão do disco e gera um QR novo.
- **Remover:** apaga a linha. O worker derruba a conexão e apaga a sessão do disco.

## O que é gravado

Para cada mensagem que chega ou sai (`messages.upsert`) e para o histórico recente que o WhatsApp manda ao conectar (`messaging-history.set`):

- **Só conversas individuais.** Grupos e status são ignorados (o contato precisa terminar em `@s.whatsapp.net` ou `@lid`).
- **Uma conversa por contato por dia** (`conversas`, chave única `instancia_id + contato + data`), no fuso de São Paulo.
- **Cada mensagem** vai para `mensagens` com remetente (`vendedor` ou `cliente`), tipo (texto, áudio, imagem, vídeo, documento), texto ou legenda e horário. Mensagens repetidas são ignoradas pelo id do WhatsApp.
- **Áudios** dos últimos 2 dias são baixados (`downloadMediaMessage`) e enviados para o bucket privado `audios` do Supabase, na pasta do vendedor. O worker transcreve com o Whisper a cada 20 segundos. Áudios mais antigos do histórico não são baixados.
- **Filtro opcional:** a variável `LEAD_ALLOWLIST` limita a gravação a números específicos. Vazia, grava todas as conversas individuais.
- Imagens, vídeos e documentos são registrados (tipo e legenda), mas o arquivo não é baixado.

Depois disso, o resto do worker usa essas tabelas: a auditoria por IA roda nas conversas paradas há 20 minutos, e o espelho alimenta a planilha.

## Sinal de vida do worker

A cada ciclo de conexões (15 s) o worker grava a hora atual em `worker_status`. A tela WhatsApp usa isso:

- **Último sinal há menos de 1 minuto:** faixa verde "Worker ligado".
- **Sem sinal:** aviso dourado "Worker desligado: o QR Code não vai aparecer", com a hora do último sinal, se houver.

## Situação atual (16/10/2026)

- Worker publicado no Railway (projeto `auditoria-comercial`, serviço `worker`), com disco permanente `sessoes-whatsapp` em `/app/data`. A compilação funciona.
- **Falta colocar as chaves** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` e `TRANSCRIBE_API_KEY` nas variáveis do serviço. Sem a do Supabase o worker para ao ligar ("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY") e o QR não aparece.
- A leitura do QR com um celular de verdade **ainda não foi testada**. O código foi conferido contra a versão instalada do Baileys (funções e eventos existem com os nomes usados).

## Riscos e limites

- **Não é a API oficial.** O WhatsApp pode restringir ou banir números com comportamento de disparo em massa. Mensagens personalizadas e em ritmo humano reduzem o risco.
- **O Baileys depende do WhatsApp Web.** Quando o WhatsApp muda o protocolo, pode ser preciso atualizar a biblioteca (`npm update` no worker e publicar de novo).
- **O celular precisa ficar com internet de vez em quando.** Se o aparelho principal ficar muito tempo offline, o WhatsApp desconecta os aparelhos vinculados e o QR precisa ser lido de novo.
- **Ligações não passam por aqui.** O WhatsApp não entrega gravação de ligação; elas entram pelo envio do arquivo na tela Ligações.
- **LGPD:** o sistema guarda conversas e áudios de clientes.

## E a Uazapi?

A Uazapi é um serviço brasileiro pago que faz o mesmo papel do nosso worker: ela mantém a sessão do WhatsApp (também não oficial, por QR Code) nos servidores dela e entrega as mensagens por API e webhook.

Hoje o sistema **não usa** a Uazapi. Trocar faria sentido se quiséssemos tirar do nosso lado a manutenção da conexão (atualizar o Baileys, cuidar do worker 24h). Em linhas gerais, a troca seria:

1. Criar uma instância na Uazapi para cada SDR e mostrar o QR que ela devolve, em vez do QR do Baileys.
2. Receber as mensagens pelo webhook da Uazapi (uma rota no site ou no worker) e gravar nas mesmas tabelas `conversas` e `mensagens`.
3. Baixar os áudios pela API dela.
4. O resto (transcrição, auditoria, painel, planilha) continua igual.

Os detalhes (formato do webhook, rotas, autenticação, preço) dependem da documentação e do plano contratado na Uazapi. Esta seção não foi conferida contra a documentação dela.
