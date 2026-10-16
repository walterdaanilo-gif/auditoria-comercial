export type Papel = "admin" | "gestor" | "vendedor";

export interface Perfil { id: string; nome: string; email: string; papel: Papel; ativo: boolean; criado_em: string }
export interface Instancia { id: string; vendedor_id: string; nome: string; numero: string | null; status: string; qr: string | null; comando: string | null; atualizado_em: string }
export interface Conversa { id: string; vendedor_id: string; contato: string; contato_nome: string | null; canal: string; data: string; ultima_msg_em: string }
export interface Mensagem { id: string; remetente: "vendedor" | "cliente"; texto: string | null; tipo: string; transcricao: string | null; enviada_em: string }
export interface Auditoria {
  id: string; conversa_id: string | null; ligacao_id: string | null; vendedor_id: string; nota_geral: number;
  notas: Record<string, number>; gatilhos: Record<string, boolean>; pontos_fortes: string | null; pontos_melhoria: string | null;
  resumo: string | null; qualidade: "boa" | "regular" | "ruim" | null; etapa: string | null; objecoes: string | null;
  agendou: boolean; efetiva: boolean; msg_count: number; atualizado_em: string;
}

export const GATILHOS: Record<string, string> = {
  personalizacao: "Personalização", pergunta_aberta: "Pergunta aberta", beneficio_claro: "Benefício claro",
  prova_social: "Prova social", autoridade: "Autoridade", escassez_urgencia: "Escassez / urgência",
  reciprocidade: "Reciprocidade", tratamento_objecao: "Tratamento de objeção", chamada_para_acao: "Chamada para ação", followup: "Follow-up",
};
export const CRITERIOS: Record<string, string> = {
  abertura: "Abertura", descoberta: "Descoberta", beneficio: "Benefício", objecoes: "Objeções", chamada_para_acao: "Chamada para ação", tom: "Tom",
};
