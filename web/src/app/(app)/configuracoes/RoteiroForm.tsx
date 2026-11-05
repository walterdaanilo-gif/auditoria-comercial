import { salvarRoteiro } from "./roteiro-actions";

// Editor do roteiro dentro de Configuracoes. Admin edita; gestor so le (a RLS tambem exige admin para gravar).
export default function RoteiroForm({ roteiro, podeEditar, ok, erro }: { roteiro: string; podeEditar: boolean; ok: boolean; erro?: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-mute">Este texto é a régua que a IA usa para dar a nota. Quanto mais claro, mais justa a nota. A IA lê o roteiro a cada auditoria, então a mudança vale para as próximas.</p>
      {erro && <p className="rounded-xl border border-bad px-3 py-2 text-sm text-bad">{erro}</p>}
      {ok && <p className="rounded-xl border border-ok px-3 py-2 text-sm text-ok">Roteiro salvo. As próximas auditorias já usam o novo texto.</p>}
      <form action={salvarRoteiro} className="space-y-3">
        <textarea name="roteiro" defaultValue={roteiro} rows={20} readOnly={!podeEditar} className="input font-mono" aria-label="Roteiro da auditoria" />
        {podeEditar ? <button className="btn">Salvar roteiro</button> : <p className="text-xs text-mute">Só o admin edita o roteiro.</p>}
      </form>
    </div>
  );
}
