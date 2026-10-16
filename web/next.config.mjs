/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // conversas exportadas do WhatsApp (tela Testar auditor) podem passar de 1 MB
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};
export default nextConfig;
