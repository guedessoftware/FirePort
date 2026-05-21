import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import Providers from "./providers";
import { getApplicationSettings } from "@/lib/app-settings";

export async function generateMetadata(): Promise<Metadata> {
  try {
    await connection()
    const settings = await getApplicationSettings()

    return {
      title: settings.applicationName,
      description: settings.description,
    }
  } catch {
    return {
      title: "FirePort",
      description: "Area do cliente",
    }
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
