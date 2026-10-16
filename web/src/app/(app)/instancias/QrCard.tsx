"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QrCard({ qr }: { qr: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(qr, { margin: 1, width: 260 }).then(setSrc).catch(() => setSrc("")); }, [qr]);
  return src ? <img src={src} alt="QR Code do WhatsApp" width={260} height={260} className="rounded-lg bg-white p-2" /> : <p className="text-sm text-mute">Gerando QR...</p>;
}
