import { exigirAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ImportarForm from "./ImportarForm";

export const dynamic = "force-dynamic";

export default async function TestarAuditor() {
  await exigirAdmin();
  const { data } = await (await createClient()).from("profiles").select("id,nome,papel").eq("ativo", true).order("nome");
  const vendedores = (data ?? []).map((p: any) => ({ id: p.id, nome: p.nome }));
  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Testar Cabueta</h1>
        <p className="page-sub">Importe uma conversa real do WhatsApp e veja a nota da IA, sem conectar nenhum número.</p></div>
      <div className="aviso space-y-1">
        <b className="text-base text-warn">Como exportar no celular</b>
        <p><b>Android:</b> abra a conversa, toque nos três pontinhos, Mais, Exportar conversa, <b>Sem mídia</b>.</p>
        <p><b>iPhone:</b> abra a conversa, toque no nome do contato, Exportar conversa, <b>Sem mídia</b>.</p>
        <p>Mande o arquivo para você mesmo (e-mail ou Drive), salve no computador e escolha aqui. Se vier um .zip, abra e use o .txt.</p>
      </div>
      <ImportarForm vendedores={vendedores} />
      <p className="text-sm text-mute">A conversa entra na fila e o worker dá a nota em até 5 minutos. Conversas importadas aparecem em Conversas, mas ficam fora das metas, da atividade ao vivo e da planilha.</p>
    </div>
  );
}
