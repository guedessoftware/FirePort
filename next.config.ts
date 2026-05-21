import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production"

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ")

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["192.168.1.8", "10.99.1.14"],
  serverExternalPackages: ["net-snmp", "ssh2"],
  turbopack: {},
  async headers() {
    const headers = [
      {
        key: "Content-Security-Policy",
        value: contentSecurityPolicy,
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      ...(!isDev
        ? [
            {
              key: "Cross-Origin-Opener-Policy",
              value: "same-origin",
            },
            {
              key: "Strict-Transport-Security",
              value: "max-age=63072000; includeSubDomains; preload",
            },
          ]
        : []),
    ]

    return [
      {
        source: "/(.*)",
        headers,
      },
    ]
  },
  webpack: (config, { dev }) => {
    if (dev) {
      const currentIgnored = config.watchOptions?.ignored
      const ignored = Array.isArray(currentIgnored)
        ? currentIgnored
        : currentIgnored
          ? [currentIgnored]
          : []
      const validIgnored = ignored.filter((item): item is string => typeof item === "string" && item.length > 0)

      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...validIgnored,
          "**/prisma/*.db",
          "**/prisma/*.db-journal",
          "**/prisma/*.db-shm",
          "**/prisma/*.db-wal",
        ],
      }
    }

    return config
  },
};

export default nextConfig;
