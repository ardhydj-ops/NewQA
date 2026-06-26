import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AppSidebar } from "@/components/app-sidebar";
import { AIChatPanel } from "@/components/chat/ai-chat-panel";
import { ChatProvider } from "@/components/chat/chat-context";
import { LanguageProvider } from "@/components/i18n/language-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinApp — Financial Tracker",
  description: "Personal financial tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <LanguageProvider>
          <QueryProvider>
            <TooltipProvider>
              <ChatProvider>
                <SidebarProvider>
                  <AppSidebar />
                  <SidebarInset>
                    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
                      <SidebarTrigger />
                      <Separator orientation="vertical" className="h-4" />
                      <div className="ml-auto">
                        <LanguageSwitcher />
                      </div>
                    </header>
                    <main className="flex-1 p-6">{children}</main>
                  </SidebarInset>
                  <AIChatPanel />
                </SidebarProvider>
              </ChatProvider>
            </TooltipProvider>
            <Toaster />
          </QueryProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
