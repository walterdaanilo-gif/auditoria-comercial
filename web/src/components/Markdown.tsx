// Renderizador simples e seguro (React escapa o texto): titulos ##, listas e negrito
function inline(t: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
}
export default function Markdown({ texto }: { texto: string }) {
  const out: React.ReactNode[] = [];
  let lista: { tipo: "ul" | "ol"; itens: string[] } | null = null;
  const fecha = () => {
    if (!lista) return;
    const L = lista; const itens = L.itens.map((x, i) => <li key={i}>{inline(x)}</li>);
    out.push(L.tipo === "ul" ? <ul key={out.length} className="ml-5 list-disc space-y-1">{itens}</ul> : <ol key={out.length} className="ml-5 list-decimal space-y-1">{itens}</ol>);
    lista = null;
  };
  for (const bruto of texto.split("\n")) {
    const l = bruto.trim();
    if (l.startsWith("## ")) { fecha(); out.push(<h3 key={out.length} className="mt-4 mb-1 font-bold">{l.slice(3)}</h3>); }
    else if (/^[-*]\s/.test(l)) { if (lista?.tipo !== "ul") { fecha(); lista = { tipo: "ul", itens: [] }; } lista!.itens.push(l.slice(2)); }
    else if (/^\d+[.)]\s/.test(l)) { if (lista?.tipo !== "ol") { fecha(); lista = { tipo: "ol", itens: [] }; } lista!.itens.push(l.replace(/^\d+[.)]\s/, "")); }
    else if (!l) fecha();
    else { fecha(); out.push(<p key={out.length} className="my-1">{inline(l)}</p>); }
  }
  fecha();
  return <div className="text-sm leading-relaxed">{out}</div>;
}
