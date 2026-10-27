// Logo da empresa aberta: a da Weevo e imagem; as outras (Carbone), o nome escrito na cor da empresa ate ter o logo
export default function Marca({ empresa, icone = false }: { empresa: { slug: string; nome: string } | null; icone?: boolean }) {
  if (!empresa || empresa.slug === "weevo") return icone ? <img src="/weevo-icone.png" alt="Weevo" className="h-7 w-auto" /> : <img src="/weevo-logo.png" alt="Weevo" className="h-6 w-auto md:h-7" />;
  if (icone) return <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-extrabold text-bg">{empresa.nome.slice(0, 1)}</span>;
  return <span className="text-lg font-extrabold uppercase tracking-[0.18em] text-brand md:text-xl">{empresa.nome}</span>;
}
