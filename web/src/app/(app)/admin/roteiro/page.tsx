import { redirect } from "next/navigation";

// O roteiro agora fica em Configuracoes. O endereco antigo leva para la.
export default function Roteiro() {
  redirect("/configuracoes?abrir=roteiro");
}
