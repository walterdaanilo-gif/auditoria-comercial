export type Papel = "admin" | "gestor" | "vendedor";

export interface Perfil {
  id: string; nome: string; email: string; papel: Papel; ativo: boolean; criado_em: string; foto_url?: string | null;
  funcao?: "sdr" | "closer"; fonte_conversas?: "whatsapp" | "crm";
  // empresa principal, empresas que pode abrir e a que esta aberta agora (Weevo, Carbone...)
  org_id: string; orgs_acesso: string[]; org_ativa: string | null; super_admin: boolean;
}
export interface Organizacao { id: string; slug: string; nome: string }
export interface Instancia { id: string; vendedor_id: string; nome: string; numero: string | null; status: string; qr: string | null; comando: string | null; atualizado_em: string }
export interface Conversa { id: string; vendedor_id: string; contato: string; contato_nome: string | null; canal: string; data: string; ultima_msg_em: string }
export interface Mensagem { id: string; remetente: "vendedor" | "cliente"; texto: string | null; tipo: string; transcricao: string | null; enviada_em: string }
export interface Auditoria {
  id: string; conversa_id: string | null; ligacao_id: string | null; vendedor_id: string; nota_geral: number;
  primeira_resposta_seg: number | null; tempo_medio_resposta_seg: number | null; respostas_sdr: number | null;
  rubrica?: string | null; notas_1a5?: { chave: string; nome: string; peso: number; nota: number; justificativa: string }[] | null;
  venda?: boolean; venda_tipo?: "workshop" | "imersao" | null; venda_valor?: number | null; venda_cupom?: boolean; venda_evidencia?: string | null;
  oportunidade?: boolean; oportunidade_tipo?: string | null; oportunidade_evidencia?: string | null;
  critico?: boolean; critico_motivo?: string | null; so_bot?: boolean; manual?: boolean;
  notas: Record<string, number>; gatilhos: Record<string, boolean>; pontos_fortes: string | null; pontos_melhoria: string | null;
  resumo: string | null; qualidade: "boa" | "regular" | "ruim" | null; etapa: string | null; objecoes: string | null;
  agendou: boolean; remarcacao?: boolean; efetiva: boolean; msg_count: number; atualizado_em: string;
}

export const GATILHOS: Record<string, string> = {
  personalizacao: "Personalização", pergunta_aberta: "Pergunta aberta", beneficio_claro: "Benefício claro",
  prova_social: "Prova social", autoridade: "Autoridade", escassez_urgencia: "Escassez / urgência",
  reciprocidade: "Reciprocidade", tratamento_objecao: "Tratamento de objeção", chamada_para_acao: "Chamada para ação", followup: "Follow-up",
};
export const CRITERIOS: Record<string, string> = {
  abertura: "Abertura", descoberta: "Descoberta", beneficio: "Benefício", objecoes: "Objeções", chamada_para_acao: "Chamada para ação", tom: "Tom",
};
