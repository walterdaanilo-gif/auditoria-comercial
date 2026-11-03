/**
 * Sincronizacao da planilha do Closer com o sistema (painel /closer), nos dois sentidos.
 *
 * Planilha -> sistema: quando uma pessoa edita, as 3 abas sao enviadas para <API_URL>/api/closer/sync.
 * Sistema -> planilha: o painel chama este Web App (doPost) quando o closer muda o progresso de um lead.
 * Reconciliacao: a cada 10 minutos envia as abas e busca o progresso mais novo do painel.
 * Em conflito vale a alteracao mais recente ("Atualizado no painel em" contra status_em do sistema).
 *
 * Script Properties (Configuracoes do projeto > Propriedades do script):
 *   API_URL      endereco do site, ex.: https://auditoria-comercial.vercel.app
 *   SYNC_SECRET  o mesmo valor de CLOSER_SYNC_SECRET na Vercel
 *
 * Passo a passo completo: docs/painel-closer.md. Os dados da planilha sao pessoais: nunca registre o conteudo em log.
 */

var ABAS = { todos: 'Todos · completude e etapas', participantes: 'Participantes', atencao: 'Atenção · etapas e duplicados' };
var COL = { situacao: 'Situação no painel', motivo: 'Motivo', anotacao: 'Anotações do closer', atualizado: 'Atualizado no painel em' };
var MSG = ['✓ Msg 1', '✓ Msg 2', '✓ Msg 3'];

// Mesmos textos de STATUS e MOTIVOS em web/src/lib/closer/regras.ts. Mudou la, mude aqui.
var STATUS = {
  novo: 'A abordar', mensagem: 'Mensagem enviada', respondeu: 'Respondeu', negociando: 'Em negociação',
  fechou_plataforma: 'Fechou Plataforma', fechou_imersao: 'Fechou Imersão', sem_resposta: 'Sem resposta', desqualificado: 'Desqualificado',
};
var MOTIVOS = ['Sem perfil', 'Sem orçamento', 'Não é o momento', 'Já é cliente', 'Contato interno ou teste', 'Número errado', 'Pediu para não receber', 'Outro'];

var SILENCIO_MS = 3000;  // espera a pessoa parar de editar por 3 s...
var JANELA_MS = 20000;   // ...mas junta as edicoes de no maximo 20 s num envio so

// ---------- Instalacao ----------

/** Rode uma vez (e de novo se mudar algo): cria as colunas de progresso, os gatilhos e faz a primeira sincronizacao. */
function instalar() {
  config_(); // confere as Script Properties antes de tudo
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['aoEditar', 'reconciliar'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aoEditar').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('reconciliar').timeBased().everyMinutes(10).create();
  prepararColunas_(true);
  var total = sincronizarTudo_();
  console.log('Instalado. Leads no sistema: ' + total);
}

// ---------- Gatilhos ----------

/** Gatilho instalavel onEdit. So edicoes de pessoas disparam; o que o script escreve nao dispara. */
function aoEditar(e) {
  if (!e || !e.range) return;
  var aba = e.range.getSheet().getName();
  if ([ABAS.todos, ABAS.participantes, ABAS.atencao].indexOf(aba) < 0) return;
  if (aba === ABAS.todos) carimbar_(e.range);

  var cache = CacheService.getScriptCache();
  cache.put('EDITADO_EM', String(Date.now()), 600);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) return; // outra execucao ja esta esperando e vai enviar esta edicao junto
  try {
    for (var rodada = 0; rodada < 5; rodada++) {
      var inicio = Date.now();
      while (Date.now() - inicio < JANELA_MS && Date.now() - Number(cache.get('EDITADO_EM') || 0) < SILENCIO_MS) Utilities.sleep(1000);
      var enviadoAte = Number(cache.get('EDITADO_EM') || 0);
      enviarAbas_();
      if (Number(cache.get('EDITADO_EM') || 0) <= enviadoAte) break; // ninguem editou durante o envio
    }
  } catch (err) {
    console.error('Closer: falha ao enviar a planilha. A reconciliação tenta de novo em 10 min. ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Gatilho de tempo (10 min): seguranca para o que se perdeu no caminho. */
function reconciliar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // ocupado; roda de novo em 10 min
  try {
    sincronizarTudo_();
  } catch (err) {
    console.error('Closer: falha na reconciliação. ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

// ---------- Web App (chamado pelo sistema) ----------

/** Publicado como "Executar como: eu" e "Acesso: qualquer pessoa". Confere o segredo no corpo. */
function doPost(e) {
  try {
    var corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!segredoIgual_(corpo.segredo)) return json_({ ok: false, erro: 'Não autorizado.' });
    if (corpo.acao === 'progresso') {
      if (!corpo.chave || !STATUS[corpo.status]) return json_({ ok: false, erro: 'Progresso inválido.' });
      aplicarNaPlanilha_([corpo]);
      return json_({ ok: true });
    }
    if (corpo.acao === 'sincronizar') {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) return json_({ ok: false, erro: 'A planilha está sincronizando agora. Tente de novo em alguns segundos.' });
      try {
        return json_({ ok: true, total: sincronizarTudo_() });
      } finally {
        lock.releaseLock();
      }
    }
    return json_({ ok: false, erro: 'Ação desconhecida.' });
  } catch (err) {
    return json_({ ok: false, erro: err.message });
  }
}

// ---------- Sincronizacao ----------

function sincronizarTudo_() {
  prepararColunas_(false);
  var total = enviarAbas_();  // primeiro a planilha (edicoes de pessoas mais novas entram no sistema)...
  buscarProgresso_();         // ...depois o que mudou no painel e e mais novo que a planilha
  return total;
}

/** Envia as 3 abas para o sistema e copia o progresso aceito para as outras linhas do mesmo lead. */
function enviarAbas_() {
  var c = config_();
  SpreadsheetApp.flush();
  var abas = { todos: valoresAba_(ABAS.todos, true), participantes: valoresAba_(ABAS.participantes, false), atencao: valoresAba_(ABAS.atencao, false) };
  var r = UrlFetchApp.fetch(c.api + '/api/closer/sync', {
    method: 'post', contentType: 'application/json', headers: { 'x-sync-secret': c.segredo },
    payload: JSON.stringify({ abas: abas }), muteHttpExceptions: true,
  });
  var j = resposta_(r);
  aplicarNaPlanilha_(j.aplicados || []);
  return j.total;
}

/** Busca o progresso alterado no painel desde a ultima busca e escreve o que for mais novo. */
function buscarProgresso_() {
  var c = config_();
  var props = PropertiesService.getScriptProperties();
  var desde = props.getProperty('ULTIMA_BUSCA') || '';
  var r = UrlFetchApp.fetch(c.api + '/api/closer/sync?desde=' + encodeURIComponent(desde), {
    method: 'get', headers: { 'x-sync-secret': c.segredo }, muteHttpExceptions: true,
  });
  var j = resposta_(r);
  aplicarNaPlanilha_(j.progresso || []);
  // 2 minutos de folga: o que vier repetido nao e escrito de novo
  props.setProperty('ULTIMA_BUSCA', new Date(new Date(j.agora).getTime() - 120000).toISOString());
}

/**
 * Escreve o progresso nas linhas de cada lead, so quando o do sistema e mais novo que "Atualizado no painel em".
 * lista: [{ chave, status, enviadas, motivo, anotacao, status_em }]
 */
function aplicarNaPlanilha_(lista) {
  if (!lista || !lista.length) return;
  var sh = aba_(ABAS.todos);
  var cab = cabecalho_(sh);
  var i = indices_(cab);
  if (i.atualizado < 0 || i.situacao < 0) throw new Error('Faltam as colunas de progresso. Rode instalar().');
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var faixa = sh.getRange(2, 1, n, cab.length);
  var texto = faixa.getDisplayValues(), bruto = faixa.getValues();

  var linhasPorChave = {};
  texto.forEach(function (l, k) {
    var ch = chave_(l[i.nome], l[i.empresa], l[i.telefone]);
    (linhasPorChave[ch] = linhasPorChave[ch] || []).push(k);
  });

  lista.forEach(function (p) {
    var em = new Date(p.status_em);
    if (!p.chave || isNaN(em.getTime()) || !STATUS[p.status]) return;
    var enviadas = Math.max(0, Math.min(3, Number(p.enviadas) || 0));
    (linhasPorChave[p.chave] || []).forEach(function (k) {
      var naPlanilha = bruto[k][i.atualizado];
      // planilha igual ou mais nova (1 s de folga): fica como esta
      if (naPlanilha instanceof Date && em.getTime() <= naPlanilha.getTime() + 1000) return;
      var linha = k + 2;
      var escrever = function (col, valor) { if (col >= 0 && bruto[k][col] !== valor) sh.getRange(linha, col + 1).setValue(valor); };
      i.msg.forEach(function (col, m) { escrever(col, enviadas >= m + 1); });
      escrever(i.situacao, STATUS[p.status]);
      escrever(i.motivo, String(p.motivo || ''));
      escrever(i.anotacao, String(p.anotacao || ''));
      sh.getRange(linha, i.atualizado + 1).setValue(em);
    });
  });
  SpreadsheetApp.flush();
}

/** Quando uma pessoa edita uma coluna de progresso, marca a hora em "Atualizado no painel em" das linhas editadas. */
function carimbar_(range) {
  var sh = range.getSheet();
  var i = indices_(cabecalho_(sh));
  if (i.atualizado < 0) return;
  var cols = i.msg.concat([i.situacao, i.motivo, i.anotacao]).filter(function (c) { return c >= 0; });
  var c1 = range.getColumn() - 1, c2 = c1 + range.getNumColumns() - 1;
  if (!cols.some(function (c) { return c >= c1 && c <= c2; })) return;
  var r1 = Math.max(2, range.getRow()), r2 = range.getRow() + range.getNumRows() - 1;
  if (r2 < r1) return;
  var agora = new Date();
  var linhas = sh.getRange(r1, 1, r2 - r1 + 1, sh.getLastColumn()).getDisplayValues();
  linhas.forEach(function (l, k) {
    // so linhas de pessoas: uma linha vazia com hora viraria um lead sem nome
    if (String(l[i.nome] || '').trim() || String(l[i.telefone] || '').trim()) sh.getRange(r1 + k, i.atualizado + 1).setValue(agora);
  });
}

/** Cria no fim da aba as colunas de progresso que faltarem. Nao mexe em nenhuma outra coluna. */
function prepararColunas_(forcarRegras) {
  var sh = aba_(ABAS.todos);
  var cab = cabecalho_(sh);
  var criou = false;
  [COL.situacao, COL.motivo, COL.anotacao, COL.atualizado].forEach(function (titulo) {
    if (cab.indexOf(titulo) >= 0) return;
    sh.getRange(1, cab.length + 1).setValue(titulo);
    cab.push(titulo);
    criou = true;
  });
  if (!criou && !forcarRegras) return;
  var linhas = Math.max(1, sh.getMaxRows() - 1);
  var col = function (t) { return sh.getRange(2, cab.indexOf(t) + 1, linhas, 1); };
  var lista = function (itens, aceitaOutro) { return SpreadsheetApp.newDataValidation().requireValueInList(itens, true).setAllowInvalid(aceitaOutro).build(); };
  col(COL.situacao).setDataValidation(lista(Object.keys(STATUS).map(function (k) { return STATUS[k]; }), false));
  col(COL.motivo).setDataValidation(lista(MOTIVOS, true));
  col(COL.atualizado).setNumberFormat('dd/MM/yyyy HH:mm:ss');
}

// ---------- Ajudantes ----------

/** Valores da aba como texto, igual ao que o site lia antes: caixas viram TRUE/FALSE; a hora do progresso vai em ISO. */
function valoresAba_(nome, ehTodos) {
  var faixa = aba_(nome).getDataRange();
  var texto = faixa.getDisplayValues(), bruto = faixa.getValues();
  var colHora = ehTodos ? texto[0].map(function (s) { return String(s).trim(); }).indexOf(COL.atualizado) : -1;
  return texto.map(function (l, r) {
    return l.map(function (v, c) {
      var b = bruto[r][c];
      if (typeof b === 'boolean') return b ? 'TRUE' : 'FALSE';
      if (c === colHora && r > 0 && b instanceof Date) return b.toISOString();
      return v;
    });
  });
}

function indices_(cab) {
  var col = function (t) { return cab.indexOf(t); };
  return {
    nome: col('Nome'), empresa: col('Empresa'), telefone: col('Telefone'), msg: MSG.map(col),
    situacao: col(COL.situacao), motivo: col(COL.motivo), anotacao: col(COL.anotacao), atualizado: col(COL.atualizado),
  };
}

// Mesma identidade de web/src/lib/closer/planilha.ts (chaveDe): fim do telefone (9 digitos) ou nome + empresa
function chave_(nome, empresa, telefone) {
  var fim = String(telefone || '').replace(/\D/g, '').slice(-9);
  if (fim) return 'tel:' + fim;
  var n = function (s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); };
  return 'nome:' + n(nome) + '|' + n(empresa);
}

function cabecalho_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].map(function (s) { return String(s).trim(); });
}

function aba_(nome) {
  var sh = SpreadsheetApp.getActive().getSheetByName(nome);
  if (!sh) throw new Error('Aba não encontrada: ' + nome);
  return sh;
}

function config_() {
  var p = PropertiesService.getScriptProperties();
  var api = String(p.getProperty('API_URL') || '').trim().replace(/\/+$/, '');
  var segredo = String(p.getProperty('SYNC_SECRET') || '').trim();
  if (!api || !segredo) throw new Error('Defina API_URL e SYNC_SECRET nas Propriedades do script.');
  return { api: api, segredo: segredo };
}

/** Lê a resposta do sistema sem registrar o conteudo. */
function resposta_(r) {
  var j = null;
  try { j = JSON.parse(r.getContentText()); } catch (err) { /* resposta nao e JSON */ }
  if (r.getResponseCode() !== 200 || !j || !j.ok) throw new Error('Sistema respondeu ' + r.getResponseCode() + (j && j.erro ? ': ' + j.erro : ''));
  return j;
}

// Comparacao em tempo constante (pelos hashes, que tem sempre o mesmo tamanho)
function segredoIgual_(recebido) {
  var certo = config_().segredo;
  if (!recebido) return false;
  var h = function (s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8); };
  var a = h(recebido), b = h(certo), dif = 0;
  for (var k = 0; k < a.length; k++) dif |= a[k] ^ b[k];
  return dif === 0;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
