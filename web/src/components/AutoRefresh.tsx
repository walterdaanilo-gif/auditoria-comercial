"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Recarrega os dados da pagina a cada N segundos (visao em tempo real)
export default function AutoRefresh({ segundos = 30 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos]);
  return null;
}
