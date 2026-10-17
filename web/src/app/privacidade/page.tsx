import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade · Auditoria Weevo",
};

const CONTATO = "walterdaanilo@gmail.com";

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 leading-relaxed">
      <h1 className="text-3xl font-semibold">Política de Privacidade</h1>
      <p className="mt-2 text-sm opacity-70">Auditoria Weevo · atualizada em 17/10/2026</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">1. Quem somos</h2>
        <p>
          A Auditoria Weevo é o sistema interno de auditoria comercial da Weevo. Ele é usado apenas pela equipe
          comercial da Weevo para revisar a qualidade das conversas de WhatsApp e das ligações com leads e clientes,
          e para organizar as reuniões agendadas com eles. O acesso é restrito a usuários cadastrados pelo
          administrador.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">2. Dados que tratamos</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Dados dos usuários do sistema: nome, e-mail e perfil de acesso.</li>
          <li>
            Conversas de WhatsApp dos números conectados pela equipe comercial: mensagens, áudios e nome e telefone
            dos contatos.
          </li>
          <li>Gravações de ligações enviadas pela equipe e suas transcrições.</li>
          <li>Notas e análises de qualidade geradas a partir dessas conversas e ligações.</li>
          <li>
            Dados de reuniões de implementação: nome do cliente, empresa, e-mail, WhatsApp, data e horário.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">3. Uso do Google Agenda</h2>
        <p>
          Quando um gestor conecta a própria conta Google em Configurações, o sistema pede a permissão
          <code className="mx-1">calendar.events</code> e a usa somente para criar e atualizar, na agenda desse gestor,
          os eventos das reuniões de implementação confirmadas pelos clientes. Quando o cliente tem e-mail cadastrado,
          ele pode ser incluído como convidado do evento.
        </p>
        <p>
          O sistema não usa esse acesso para ler, copiar, alterar ou apagar outros eventos da agenda. Os dados
          recebidos do Google não são vendidos, não são usados para publicidade e não são usados para treinar modelos
          de inteligência artificial. O token de acesso fica guardado no banco de dados do sistema e só o servidor
          consegue lê-lo.
        </p>
        <p>
          O uso e a transferência de informações recebidas das APIs do Google seguem a{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado.
        </p>
        <p>
          Para desconectar, use o botão do card Agenda Google em Configurações ou remova o acesso em{" "}
          <a
            className="underline"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">4. Para que usamos os dados</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Auditar e dar nota à qualidade do atendimento comercial.</li>
          <li>Gerar indicadores e análises para treinar a equipe.</li>
          <li>Agendar e lembrar as reuniões combinadas com os clientes.</li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">5. Com quem compartilhamos</h2>
        <p>
          Os dados não são vendidos. Eles passam apenas pelos fornecedores que fazem o sistema funcionar: Supabase
          (banco de dados, login e arquivos), Vercel e Railway (hospedagem), OpenAI (transcrição de áudios), Anthropic
          (análise das conversas por inteligência artificial) e Google (Agenda e planilha de indicadores).
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">6. Segurança e retenção</h2>
        <p>
          Cada vendedor vê apenas os próprios dados. Gestores e administradores veem os dados da equipe. Os dados
          ficam guardados pelo tempo necessário à auditoria comercial ou até um pedido de exclusão.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">7. Seus direitos (LGPD)</h2>
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados, ou tirar dúvidas sobre esta política, pelo
          e-mail{" "}
          <a className="underline" href={`mailto:${CONTATO}`}>
            {CONTATO}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
