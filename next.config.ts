import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/^\/api\/providers\/(google|microsoft)\/(callback|webhook)/] } },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }, { source: "/api/providers/:provider(google|microsoft)/callback", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }];
  },
};
export default config;
