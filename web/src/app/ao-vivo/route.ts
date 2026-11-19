// Pagina "Resultados ao vivo" para a diretoria. HTML unico (sem login), que se atualiza sozinho a cada 60 s.
// O link e /ao-vivo?k=<chave> (chave na tabela ao_vivo_link). Os numeros vem de /api/ao-vivo.
export const dynamic = "force-static";

const HTML = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>Weevo · Resultados ao vivo</title>
<style>
:root{--bg:#f3f6f5;--card:#fff;--dentro:#eef6f4;--texto:#10201e;--mute:#4f6462;--label:#0d6b5f;--linha:#d3dddb;--real:#0f9b86;--meta:#12a150;--ok:#0a7a4b;--okbg:#dcf4e7;--warn:#8a5a00;--warnbg:#fdf0cc;--bad:#b42318;--badbg:#fde3e0}
@media (prefers-color-scheme:dark){:root{--bg:#0c1212;--card:#151b1e;--dentro:#1d2527;--texto:#f0faf7;--mute:#9ba5a4;--label:#6dcfc0;--linha:#2b3433;--real:#6dcfc0;--meta:#3ee07f;--ok:#5fd39a;--okbg:rgba(95,211,154,.14);--warn:#e5a85f;--warnbg:rgba(229,168,95,.15);--bad:#ff7b6b;--badbg:rgba(255,123,107,.14)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--texto);font:16px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:16px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px}
h1{font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:var(--label);margin:0;font-weight:700}
.vivo{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--mute)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--ok);animation:p 1.6s infinite}
.dot.off{background:var(--bad);animation:none}
@keyframes p{0%{box-shadow:0 0 0 0 rgba(18,161,80,.5)}100%{box-shadow:0 0 0 10px rgba(18,161,80,0)}}
.sp{flex:1}
.tabs{display:inline-flex;border:1px solid var(--linha);border-radius:999px;overflow:hidden;background:var(--card)}
.tabs button{font:inherit;font-weight:600;font-size:14px;border:0;background:transparent;color:var(--texto);padding:8px 16px;cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--label);color:#fff}
.card{background:var(--card);border:1px solid var(--linha);border-radius:18px;padding:18px 22px}
.lb{font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--label)}
.mu{color:var(--mute);font-size:14px}
.big{font-size:clamp(36px,7vw,64px);font-weight:800;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums}
.grid{display:grid;gap:14px}.grid>*{min-width:0}
.g2b{grid-template-columns:1fr 1fr}
.g2{grid-template-columns:1.1fr 1.4fr}
.g4{grid-template-columns:repeat(4,1fr)}
@media (max-width:900px){.g2,.g2b{grid-template-columns:1fr}.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:520px){.num{font-size:26px}.card{padding:14px 16px}#prods{grid-template-columns:1fr!important}#proj{grid-template-columns:1fr!important}}
.bar{height:16px;background:var(--dentro);border-radius:8px;position:relative;margin:10px 0 4px}
.bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:8px;background:var(--real)}
.bar>b{position:absolute;top:-6px;bottom:-6px;width:3px;background:var(--texto);border-radius:2px}
.selo{display:inline-block;font-weight:700;font-size:13px;border-radius:999px;padding:3px 12px}
.ok{background:var(--okbg);color:var(--ok)}.warn{background:var(--warnbg);color:var(--warn)}.bad{background:var(--badbg);color:var(--bad)}
.num{font-size:34px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.prod{background:var(--dentro);border-radius:12px;padding:10px 14px}
.prod b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:15px}
th{text-align:left;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);padding:6px 8px;border-bottom:1px solid var(--linha)}
td{padding:9px 8px;border-bottom:1px solid var(--linha);font-variant-numeric:tabular-nums}
td.r,th.r{text-align:right;white-space:nowrap}
svg{width:100%;height:auto;display:block}
#msg{padding:40px;text-align:center;color:var(--mute)}
footer{margin:16px 0 8px;color:var(--mute);font-size:13px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Weevo · Resultados ao vivo</h1>
  <span class="vivo"><span class="dot" id="dot"></span><span id="status">carregando…</span></span>
  <span class="sp"></span>
  <div class="tabs" role="group" aria-label="Período">
    <button data-p="hoje" aria-pressed="false">Hoje</button>
    <button data-p="semana" aria-pressed="false">Semana</button>
    <button data-p="mes" aria-pressed="true">Mês</button>
  </div>
</header>
<div id="msg">Carregando os números…</div>
<main id="app" hidden>
  <div class="grid g2">
    <section class="card" aria-label="Faturamento">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="lb">Faturamento · <span id="rot"></span></span><span id="selo"></span></div>
      <div class="big" id="fat"></div>
      <div id="metaTxt" class="mu"></div>
      <div class="bar" id="barra" hidden><i id="barraI"></i><b id="barraR" title="ritmo"></b></div>
      <div class="mu" id="ritmoTxt"></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:14px" id="proj"></div>
    </section>
    <section class="card" aria-label="Evolução do faturamento">
      <div class="lb" style="margin-bottom:6px">Acumulado x meta</div>
      <div id="graf"></div>
    </section>
  </div>
  <div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))" id="prods"></div>
  <div class="grid g4" style="margin-top:14px" id="kpis"></div>
  <div class="grid g2b" style="margin-top:14px" id="duas">
    <section class="card" aria-label="Conversão do evento">
      <div class="lb">Conversão do evento</div>
      <div id="conv"></div>
    </section>
    <section class="card" aria-label="Time">
      <div class="lb" style="margin-bottom:6px">Time</div>
      <table><thead><tr><th>Pessoa</th><th>Função</th><th class="r">Vendas</th><th class="r">Valor</th></tr></thead><tbody id="time"></tbody></table>
    </section>
  </div>
</main>
<footer>Atualiza sozinho a cada 60 segundos · <span id="cont"></span></footer>
</div>
<script>
(function(){
var K=new URLSearchParams(location.search).get("k")||"";
var P="mes",T=60,resta=T,busy=false;
var NOME={plataforma:"Plataforma",imersao:"Imersão",incompany:"In-Company",workshop:"Workshop",outro:"Outro"};
var $=function(i){return document.getElementById(i)};
function moeda(n){return "R$ "+Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}
function mil(n){return n===0?"0":Math.round(n/1000)+" mil"}
function pct(a,b){return b>0?Math.round(a/b*100)+"%":"—"}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function selo(c,t){return '<span class="selo '+c+'">'+esc(t)+'</span>'}
function grafico(d){
  var f=d.fat,N=Math.max(d.periodo.diasUteisMes,1),W=640,H=260,x0=54,x1=600,yT=14,yB=226;
  var s=f.serie||[];if(!s.length)return '<p class="mu">Sem vendas no período.</p>';
  var top=Math.max(f.meta||0,f.projecao||0,f.real,1)*1.08;
  var X=function(du){return x0+(du/N)*(x1-x0)},Y=function(v){return yB-(v/top)*(yB-yT)};
  var pts=[[X(0),Y(0)]].concat(s.map(function(p){return [X(p.du),Y(p.real)]}));
  var path=function(a){return a.map(function(p,i){return (i?"L":"M")+p[0].toFixed(1)+","+p[1].toFixed(1)}).join(" ")};
  var g='';for(var i=0;i<=4;i++){var v=top*i/4;g+='<line x1="'+x0+'" x2="'+x1+'" y1="'+Y(v)+'" y2="'+Y(v)+'" stroke="var(--linha)"/><text x="'+(x0-6)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="var(--mute)">'+mil(v)+'</text>'}
  var last=s[s.length-1];
  var out='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Faturamento acumulado">'+g;
  if(f.meta)out+='<path d="'+path([[X(0),Y(0)],[X(N),Y(f.meta)]])+'" fill="none" stroke="var(--meta)" stroke-width="2.5" stroke-dasharray="7 5"/>';
  if(f.projecao&&last.du<N)out+='<path d="'+path([[X(last.du),Y(f.real)],[X(N),Y(f.projecao)]])+'" fill="none" stroke="var(--texto)" stroke-width="2.5" stroke-dasharray="2 5" stroke-linecap="round"/>';
  out+='<path d="'+path(pts)+'" fill="none" stroke="var(--real)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="'+X(last.du)+'" cy="'+Y(f.real)+'" r="6" fill="var(--real)"/>';
  out+='<text x="'+x0+'" y="'+(H-6)+'" font-size="11" fill="var(--mute)">início</text><text x="'+x1+'" y="'+(H-6)+'" text-anchor="end" font-size="11" fill="var(--mute)">dia útil '+N+'</text></svg>';
  out+='<div class="mu" style="display:flex;gap:16px;flex-wrap:wrap"><span style="color:var(--real)">━ Realizado</span>'+(f.meta?'<span style="color:var(--meta)">╍ Meta pelos dias úteis</span>':'')+(f.projecao&&last.du<N?'<span>··· Projeção</span>':'')+'</div>';
  return out;
}
function pinta(d){
  var f=d.fat,pe=d.periodo;
  $("rot").textContent=pe.rotulo+" ("+pe.intervalo+")";
  $("fat").textContent=moeda(f.real);
  var bar=$("barra");
  if(f.meta&&pe.mensal){
    var pc=Math.round(f.pct||0),dif=(f.pct||0)-(f.ritmoPct||0);
    $("metaTxt").innerHTML='de <b>'+moeda(f.meta)+'</b> · <b style="color:var(--label)">'+pc+'%</b> da meta do mês';
    bar.hidden=false;$("barraI").style.width=Math.min(100,pc)+"%";$("barraR").style.left="calc("+Math.min(100,f.ritmoPct||0)+"% - 1px)";
    $("ritmoTxt").textContent="Ritmo esperado hoje: "+Math.round(f.ritmoPct||0)+"% · dia útil "+pe.diaUtil+" de "+pe.diasUteisMes;
    $("selo").innerHTML=dif>=0?selo("ok","no ritmo"):selo(dif>-10?"warn":"bad",Math.round(-dif)+" pts abaixo do ritmo");
    $("proj").innerHTML='<div class="prod"><span class="mu">Projeção do mês</span><b>'+moeda(f.projecao||0)+'</b></div><div class="prod"><span class="mu">Precisa por dia útil</span><b>'+(f.precisaPorDia!=null?moeda(f.precisaPorDia):"meta batida")+'</b></div>';
  }else{
    $("metaTxt").textContent="A meta do mês vale só para o período Mês.";bar.hidden=true;$("ritmoTxt").textContent="";$("selo").innerHTML="";$("proj").innerHTML="";
  }
  $("graf").innerHTML=grafico(d);
  $("prods").innerHTML=(f.produtos||[]).map(function(p){return '<div class="card" style="padding:12px 16px"><span class="mu">'+esc(NOME[p.produto]||p.produto)+'</span><div class="num">'+moeda(p.valor)+'</div><span class="mu">'+p.n+' venda'+(p.n===1?"":"s")+'</span></div>'}).join("")||'<div class="card mu">Nenhuma venda no período.</div>';
  var k=d.kpis,ks=[["Marcações do time",k.marcacoes],["Conversas trocadas",k.conversas],["Convites (R$ 0)",k.convites],["Nota média da auditoria",k.nota]];
  $("kpis").innerHTML=ks.map(function(a){return '<div class="card"><span class="lb" style="font-size:12px">'+a[0]+'</span><div class="num">'+esc(a[1]&&a[1].valor!=null?a[1].valor:"—")+'</div><span class="mu">'+esc(a[1]?a[1].sub:"")+'</span></div>'}).join("");
  var c=d.conversao;
  $("conv").innerHTML=c?'<div class="num" style="margin-top:6px">'+pct(c.total,c.presentes)+'</div><div class="mu">'+c.total+' venda'+(c.total===1?"":"s")+' (Imersão, In-Company e Plataforma) / '+c.presentes+' que vieram ao workshop</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">'+c.produtos.map(function(x){return '<div class="prod">'+esc(NOME[x.produto])+'<b>'+pct(x.vendas,c.presentes)+'</b><span class="mu">'+x.vendas+' venda'+(x.vendas===1?"":"s")+'</span></div>'}).join("")+'</div><p class="mu" style="margin-bottom:0">Presença medida no CRM desde 12/11/2026; no começo a taxa oscila.</p>':'<p class="mu">Sem dado do funil ainda.</p>';
  $("time").innerHTML=(d.pessoas||[]).map(function(p){return '<tr><td>'+esc(p.nome)+'</td><td>'+(p.tipo==="closer"?"Closer":"SDR")+'</td><td class="r">'+p.vendasN+'</td><td class="r">'+moeda(p.vendasValor)+'</td></tr>'}).join("")||'<tr><td colspan="4" class="mu">Sem time cadastrado.</td></tr>';
  $("msg").hidden=true;$("app").hidden=false;
  $("status").textContent="ao vivo · atualizado às "+d.atualizadoEm;$("dot").className="dot";
}
function erro(t){
  $("dot").className="dot off";$("status").textContent=t;
  if($("app").hidden){$("msg").hidden=false;$("msg").textContent=t}
}
function carrega(){
  if(busy)return;busy=true;
  fetch("/api/ao-vivo?k="+encodeURIComponent(K)+"&p="+P,{cache:"no-store"}).then(function(r){return r.json().then(function(j){return {r:r,j:j}})}).then(function(x){
    if(x.j&&x.j.ok)pinta(x.j);else erro(x.r.status===401?"Link inválido. Peça um novo link.":"Não foi possível atualizar agora. Tentando de novo…");
  }).catch(function(){erro("Sem conexão. Tentando de novo…")}).then(function(){busy=false;resta=T});
}
document.querySelectorAll(".tabs button").forEach(function(b){b.addEventListener("click",function(){
  P=b.getAttribute("data-p");document.querySelectorAll(".tabs button").forEach(function(o){o.setAttribute("aria-pressed",String(o===b))});carrega();
})});
setInterval(function(){resta--;if(resta<=0)carrega();else $("cont").textContent="próxima em "+resta+" s"},1000);
document.addEventListener("visibilitychange",function(){if(!document.hidden&&resta<T-15)carrega()});
carrega();
})();
</script>
</body>
</html>`;

export function GET() {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, s-maxage=300", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}
