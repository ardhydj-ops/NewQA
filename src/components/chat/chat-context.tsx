"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Tingkat "effort" thinking — dipakai langsung sebagai nilai
 * `output_config.effort` saat memanggil route handler /api/advisor.
 */
export type ThinkingBudget = "low" | "medium" | "high" | "xhigh" | "max";

type ChatContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Apakah extended thinking aktif. Default: false. */
  thinkingEnabled: boolean;
  setThinkingEnabled: (enabled: boolean) => void;
  /** Tingkat effort thinking. Default: "max". */
  thinkingBudget: ThinkingBudget;
  setThinkingBudget: (budget: ThinkingBudget) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState<ThinkingBudget>("max");

  const value = useMemo<ChatContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
      thinkingEnabled,
      setThinkingEnabled,
      thinkingBudget,
      setThinkingBudget,
    }),
    [isOpen, thinkingEnabled, thinkingBudget]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
