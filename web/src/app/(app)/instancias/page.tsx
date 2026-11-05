import { redirect } from "next/navigation";

// A conexao de WhatsApp agora fica dentro de Usuarios. O endereco antigo leva para la.
export default function Instancias() {
  redirect("/admin/usuarios");
}
