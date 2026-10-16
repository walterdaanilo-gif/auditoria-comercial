// Molde das telas de acesso (login, recuperar e redefinir senha) no estilo do login da Weevo
export default function AuthShell({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(900px_500px_at_100%_0%,rgba(28,71,70,0.55),transparent_60%)]">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-[84px] max-w-6xl items-center px-6"><img src="/weevo-logo.png" alt="Weevo" className="h-7 w-auto" /></div>
      </header>
      <main className="flex justify-center px-4 py-10 md:py-16">
        <div className="w-full max-w-[560px] rounded-[28px] border border-white/15 bg-gradient-to-b from-[#4b5c5c]/80 via-[#262f33]/90 to-[#162224]/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur md:p-10">
          <h1 className="text-[40px] font-extrabold leading-tight tracking-tight">{titulo}</h1>
          {subtitulo && <p className="mt-2 text-lg leading-snug text-[#c3cdcc]">{subtitulo}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
