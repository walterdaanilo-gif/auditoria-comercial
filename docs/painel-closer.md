# Painel do Closer

Tela `/closer`: fila de leads da planilha de participantes dos workshops, com três visualizações (Painel, Tabela e Individual), dor relatada e mensagens prontas. Aparece para gestor, admin e usuários com a função Closer.

A planilha e o painel ficam sincronizados nos dois sentidos por um Google Apps Script ligado à planilha (`apps-script/closer-sync.gs`): o que muda num lado aparece no outro em segundos.

## Para publicar

### 1. Banco
Rode `supabase/painel_closer.sql` no SQL Editor do Supabase (uma vez). Ele cria a tabela `closer_leads`. A sincronização não precisa de outra mudança no banco.

### 2. Criar o segredo
Gere um texto longo e aleatório (por exemplo, 40 letras e números). Ele vai em dois lugares: na Vercel (`CLOSER_SYNC_SECRET`) e no Apps Script (`SYNC_SECRET`). Não coloque no código nem mande por chat aberto.

### 3. Colar o script na planilha
1. Abra a [planilha](https://docs.google.com/spreadsheets/d/1QzximMIdkM5ISkw1rlRbmOldsJHTTSCu9W0s1Rjfkbw) com a conta que vai "ser dona" do script.
2. Menu **Extensões > Apps Script**.
3. Apague o conteúdo do arquivo `Código.gs` e cole todo o `apps-script/closer-sync.gs`. Salve (ícone de disquete).
4. Em **Configurações do projeto** (engrenagem), confira o fuso horário: `(GMT-03:00) São Paulo`.

### 4. Definir as Script Properties
Ainda em **Configurações do projeto > Propriedades do script > Adicionar propriedade**:

| Propriedade | Valor |
|---|---|
| `API_URL` | endereço do site, sem barra no fim (hoje: `https://auditoria-comercial-omega.vercel.app`) |
| `SYNC_SECRET` | o segredo do passo 2 |

### 5. Publicar o Web App
1. **Implantar > Nova implantação**, tipo **App da Web**.
2. **Executar como: eu**. **Quem pode acessar: qualquer pessoa**.
3. Clique em **Implantar**, autorize e copie o **URL do app da Web** (termina em `/exec`).

Quando mudar o script depois, use **Implantar > Gerenciar implantações > editar (lápis) > Versão: Nova versão**. Assim o URL continua o mesmo.

### 6. Instalar os gatilhos
No editor, escolha a função **`instalar`** na barra de cima e clique em **Executar**. Ela:
- cria no fim da aba "Todos · completude e etapas" as colunas que faltarem: **Situação no painel** (lista), **Motivo** (lista), **Anotações do closer** e **Atualizado no painel em**;
- cria o gatilho de edição (`aoEditar`) e o de 10 em 10 minutos (`reconciliar`);
- faz a primeira sincronização completa.

Rodar `instalar` de novo não duplica os gatilhos. Ela falha se o passo 7 ainda não estiver no ar; nesse caso, termine o passo 7 e rode de novo.

### 7. Variáveis na Vercel (projeto do Walter)
**Settings > Environment Variables**, para Production:

| Variável | Valor |
|---|---|
| `CLOSER_SYNC_SECRET` | o segredo do passo 2 |
| `CLOSER_APPS_SCRIPT_URL` | o URL do Web App do passo 5 |
| `CLOSER_ORG_SLUG` | opcional; padrão `weevo` |

Depois faça um **Redeploy** para as variáveis valerem. A antiga `GOOGLE_SERVICE_ACCOUNT_JSON` não é mais usada pelo site (o worker continua usando a dele; não apague lá).

### 8. Testar
1. **Planilha → sistema:** na aba "Todos", mude a **Situação no painel** de um lead. Em até ~25 segundos, abra `/closer` (atualize a página): a situação deve estar igual.
2. **Sistema → planilha:** no painel, marque outra situação ou uma mensagem enviada. Em poucos segundos a linha da planilha muda (caixas ✓ Msg, Situação, Motivo, Anotações e a hora).
3. **Botão:** como gestor, clique em **Atualizar da planilha**. Deve aparecer "N leads atualizados".
4. Se algo não acontecer: no Apps Script, menu **Execuções** mostra os erros (sem dados das pessoas).

## Como os dados funcionam

- **Planilha → sistema:** quando uma pessoa edita uma das 3 abas, o script espera ela parar de editar (até 20 s, juntando as edições) e envia as abas para `/api/closer/sync`. O sistema substitui só a coluna `dados`: o progresso do closer não é apagado.
- **Progresso na planilha:** ao editar ✓ Msg 1/2/3, Situação, Motivo ou Anotações, o script marca a hora em **Atualizado no painel em**. Essa edição só vale no sistema se for mais nova que a última mudança feita no painel.
- **Sistema → planilha:** quando o closer muda o progresso no painel, o banco grava primeiro; depois o site chama o Web App, que escreve em todas as linhas daquele lead. Se essa chamada falhar, o painel salva normalmente e a reconciliação corrige.
- **Reconciliação (10 min):** envia as abas e busca o progresso que mudou no painel. Em conflito, vale a alteração mais recente.
- **Caixas ✓ Msg:** marcadas conforme as mensagens enviadas (1, 2 ou 3).
- O script só escreve nas colunas de progresso; as de mensagem e as outras não são tocadas. Escritas do script não disparam o gatilho de edição, então não há vai-e-volta.
- Quem sai da planilha continua no banco. Remover um lead é feito manualmente.
- A identidade do lead é o fim do telefone (9 dígitos) ou, sem telefone, nome e empresa. Linhas com o mesmo telefone viram um lead só. A regra está em `planilha.ts` (`chaveDe`) e repetida no script (`chave_`).
- Tudo que vem da planilha vai para a empresa Weevo (`CLOSER_ORG_SLUG`).
- A situação registrada no painel não vai para o CRM.

## Segurança

- `/api/closer/sync` não usa login: só aceita chamadas com o cabeçalho `x-sync-secret` igual a `CLOSER_SYNC_SECRET` (comparação em tempo constante).
- O Web App confere o mesmo segredo no corpo da requisição.
- `API_URL` e `SYNC_SECRET` ficam nas Propriedades do script, nunca no código.
- Os dados são pessoais (nomes e telefones): nem o site nem o script registram o conteúdo em log.
- Para trocar o segredo: mude nos dois lugares (Vercel + Propriedades do script) e faça Redeploy na Vercel.

## Regras

Ficam em `web/src/lib/closer/regras.ts`:

- **Temperatura:** quente = reunião de implementação ou interesse em imersão; morno = nota 9 ou 10 e dor relatada; frio = o resto.
- **Conferir antes de abordar:** aviso na Mensagem 1 da planilha, sem telefone, Chat interno ou Suporte/Pós-vendas no CRM.
- **Orientações de venda:** copiadas da aba "Orientações do envio". Se a aba mudar, atualize a constante `ORIENTACOES`.
- **Situações e motivos:** se mudar `STATUS` ou `MOTIVOS`, mude também no topo de `apps-script/closer-sync.gs` e rode `instalar` de novo (atualiza as listas).

As abas e colunas são localizadas pelo título: renomear aba ou coluna exige ajustar `planilha.ts` e o script.

## Prévia no computador

Com o arquivo `web/.local/closer-leads.json` (fora do git, contém dados pessoais), o modo de desenvolvimento lê os leads dele e grava o progresso em `web/.local/closer-progresso.json`, sem tocar no banco nem na planilha.
