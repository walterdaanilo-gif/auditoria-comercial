# Painel do Closer

Tela `/closer`: fila de leads da planilha de participantes dos workshops, com três visualizações (Painel, Tabela e Individual), dor relatada e mensagens prontas. Aparece para gestor, admin e usuários com a função Closer.

## Para publicar

1. **Banco:** rode `supabase/painel_closer.sql` no SQL Editor do Supabase. Ele cria a tabela `closer_leads`.
2. **Vercel:** crie a variável `GOOGLE_SERVICE_ACCOUNT_JSON` com o mesmo JSON da conta de serviço do worker.
3. **Planilha:** compartilhe a planilha com o e-mail da conta de serviço (`client_email` do JSON), como Leitor.
4. **Deploy:** publique o site. Nenhuma mudança no worker é necessária.
5. **Primeira carga:** abra a tela Closer como gestor, com a empresa Weevo aberta, e clique em **Atualizar da planilha**.

A planilha usada está em `web/src/lib/closer/google.ts`. Para trocar, defina `CLOSER_SHEET_ID` na Vercel. As abas são localizadas pelo nome e as colunas pelo título: renomear aba ou coluna exige ajustar o código.

## Como os dados funcionam

- **Atualizar da planilha** substitui só a coluna `dados`. Situação, mensagens enviadas, motivo e anotações do closer continuam como estão.
- Quem sai da planilha continua no banco. Remover um lead é feito manualmente.
- A identidade do lead é o fim do telefone (9 dígitos) ou, sem telefone, nome e empresa. Linhas com o mesmo telefone viram um lead só.
- A situação registrada no painel não volta para a planilha nem para o CRM.

## Regras

Ficam em `web/src/lib/closer/regras.ts`:

- **Temperatura:** quente = reunião de implementação ou interesse em imersão; morno = nota 9 ou 10 e dor relatada; frio = o resto.
- **Conferir antes de abordar:** aviso na Mensagem 1 da planilha, sem telefone, Chat interno ou Suporte/Pós-vendas no CRM.
- **Orientações de venda:** copiadas da aba "Orientações do envio". Se a aba mudar, atualize a constante `ORIENTACOES`.

## Prévia no computador

Com o arquivo `web/.local/closer-leads.json` (fora do git, contém dados pessoais), o modo de desenvolvimento lê os leads dele e grava o progresso em `web/.local/closer-progresso.json`, sem tocar no banco.
