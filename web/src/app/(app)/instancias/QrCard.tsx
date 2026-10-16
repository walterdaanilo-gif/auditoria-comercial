"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

// A Uazapi manda o QR pronto como imagem (data:image/...). O Baileys manda o texto do QR, que vira imagem aqui.
export default function QrCard({ qr }: { qr: string }) {
  const imagem = qr.startsWith("data:image");
  const [src, setSrc] = useState(imagem ? qr : "");
  useEffect(() => {
    if (imagem) { setSrc(qr); return; }
    QRCode.toDataURL(qr, { margin: 1, width: 260 }).then(setSrc).catch(() => setSrc(""));
  }, [qr, imagem]);
  return src ? <img src={src} alt="QR Code do WhatsApp" width={260} height={260} className="rounded-lg bg-white p-2" /> : <p className="text-sm text-mute">Gerando QR...</p>;
}
