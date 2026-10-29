// Aparece na hora do clique, enquanto o servidor monta a proxima tela (antes a tela ficava parada sem resposta)
export default function Carregando() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Carregando">
      <div className="flex items-center gap-3 text-mute">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
        <span className="text-sm font-semibold">Carregando...</span>
      </div>
      <div className="h-9 w-64 animate-pulse rounded-xl bg-track" />
      <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-3xl bg-card" />)}</div>
      <div className="h-72 animate-pulse rounded-3xl bg-card" />
    </div>
  );
}
