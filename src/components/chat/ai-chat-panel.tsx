"use client";

import { useEffect, useRef, useState } from "react";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Settings,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useChat,
  type ThinkingBudget,
} from "@/components/chat/chat-context";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  /** Pesan sambutan awal — tidak ikut dikirim ke API sebagai riwayat. */
  isWelcome?: boolean;
};

// Label rapi untuk ditampilkan ke user (bukan nilai mentah yang lowercase).
const BUDGET_LABELS: Record<ThinkingBudget, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

// Pesan sambutan; ditampilkan di UI tapi di-skip saat menyusun riwayat ke API.
const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  isWelcome: true,
  content:
    "Halo! Saya **AI Financial Advisor** Anda. Tanyakan apa saja seputar keuangan pribadi — anggaran, menabung, dana darurat, dan lainnya.",
};

/** Bentuk minimal yang dikirim ke API: hanya role + content. */
function toApiMessage(m: Message): { role: "user" | "assistant"; content: string } {
  return { role: m.role, content: m.content };
}

/** Welcome message tidak dikirim sebagai riwayat (hemat token, bukan konteks). */
function isWelcomeMessage(m: Message): boolean {
  return m.isWelcome === true || m.content.includes("AI Financial Advisor");
}

const markdownComponents = {
  h1: ({ ...props }) => (
    <h1 className="mb-2 text-base font-semibold" {...props} />
  ),
  h2: ({ ...props }) => (
    <h2 className="mb-2 text-sm font-semibold" {...props} />
  ),
  h3: ({ ...props }) => (
    <h3 className="mb-1.5 text-sm font-semibold" {...props} />
  ),
  h4: ({ ...props }) => (
    <h4 className="mb-1.5 text-sm font-semibold" {...props} />
  ),
  h5: ({ ...props }) => (
    <h5 className="mb-1.5 text-sm font-semibold" {...props} />
  ),
  h6: ({ ...props }) => (
    <h6 className="mb-1.5 text-sm font-semibold" {...props} />
  ),
  p: ({ ...props }) => (
    <p className="mb-2 text-sm leading-relaxed last:mb-0" {...props} />
  ),
  ul: ({ ...props }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 text-sm last:mb-0" {...props} />
  ),
  ol: ({ ...props }) => (
    <ol
      className="mb-2 list-decimal space-y-1 pl-5 text-sm last:mb-0"
      {...props}
    />
  ),
  li: ({ ...props }) => <li className="text-sm leading-relaxed" {...props} />,
  strong: ({ ...props }) => <strong className="font-semibold" {...props} />,
  a: ({ ...props }) => (
    <a className="font-medium text-emerald-600 underline dark:text-emerald-400" {...props} />
  ),
  blockquote: ({ ...props }) => (
    <blockquote
      className="mb-2 border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground last:mb-0"
      {...props}
    />
  ),
  code: ({ ...props }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props} />
  ),
  table: ({ ...props }) => (
    <table className="mb-2 w-full border-collapse text-sm" {...props} />
  ),
  th: ({ ...props }) => (
    <th className="border px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: ({ ...props }) => <td className="border px-2 py-1" {...props} />,
};

// Route handler membungkus tiap thinking delta dengan penanda ini.
const THINKING_DELTA_RE =
  /\[\[THINKING_DELTA\]\]([\s\S]*?)\[\[\/THINKING_DELTA\]\]/g;

/**
 * Memisahkan satu chunk stream menjadi bagian thinking dan teks jawaban.
 * Penanda [[THINKING_DELTA]]...[[/THINKING_DELTA]] di-extract ke `thinking`,
 * sisanya dianggap teks jawaban biasa.
 */
function parseChunk(chunk: string): { text: string; thinking: string } {
  let thinking = "";
  const text = chunk.replace(THINKING_DELTA_RE, (_match, inner: string) => {
    thinking += inner;
    return "";
  });
  return { text, thinking };
}

/**
 * Bubble pesan assistant. Bila pesan punya `thinking`, tampilkan section
 * collapsible (default tertutup) di atas jawaban utama.
 */
function AssistantMessage({ message }: { message: Message }) {
  // State per-pesan; default tertutup — jangan auto-expand saat pesan baru datang.
  const [thinkingOpen, setThinkingOpen] = useState(false);

  return (
    <div className="px-1 text-sm text-foreground">
      {message.thinking && (
        <Collapsible
          open={thinkingOpen}
          onOpenChange={setThinkingOpen}
          className="mb-2"
        >
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50">
            <Brain className="size-4" />
            <span>Proses berpikir</span>
            {thinkingOpen ? (
              <ChevronUp className="ml-auto size-4" />
            ) : (
              <ChevronDown className="ml-auto size-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-[collapsible-up_200ms_ease-out] data-[state=open]:animate-[collapsible-down_200ms_ease-out]">
            <div className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm italic text-muted-foreground">
              {message.thinking}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {message.content}
      </ReactMarkdown>
    </div>
  );
}

export function AIChatPanel() {
  const {
    isOpen,
    open,
    close,
    thinkingEnabled,
    setThinkingEnabled,
    thinkingBudget,
    setThinkingBudget,
  } = useChat();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const canSend = input.trim().length > 0 && !isWaiting;

  // Jumlah pesan yang dikirim ke API (welcome message tidak dihitung).
  const apiMessageCount = messages.filter((m) => !isWelcomeMessage(m)).length;

  // Reset percakapan ke initial state (hanya welcome message).
  function resetConversation() {
    setMessages([WELCOME_MESSAGE]);
  }

  // Append delta ke pesan terakhir (placeholder assistant) secara immutable.
  function appendToLastMessage(delta: { text: string; thinking: string }) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const updated: Message = {
        ...last,
        content: last.content + delta.text,
        thinking: delta.thinking
          ? (last.thinking ?? "") + delta.thinking
          : last.thinking,
      };
      return [...prev.slice(0, -1), updated];
    });
  }

  // Baca body response token per token, parse, lalu append ke pesan terakhir.
  async function consumeStream(response: Response) {
    if (!response.body) throw new Error("Stream kosong dari server.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      appendToLastMessage(parseChunk(chunk));
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isWaiting) return;

    // Susun riwayat dari state SEKARANG (sebelum push apa pun): buang welcome
    // message, strip ke { role, content }, lalu tambah pesan user baru.
    const apiMessages = [
      ...messages.filter((m) => !isWelcomeMessage(m)).map(toApiMessage),
      { role: "user" as const, content: text },
    ];

    // Tampilkan pesan user. Placeholder assistant BARU di-push setelah request OK.
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    setInput("");
    setIsWaiting(true);

    let placeholderPushed = false;
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          thinking: thinkingEnabled,
          budget: thinkingBudget,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      // Request sudah dimulai & OK → baru push placeholder yang akan diisi stream.
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          thinking: thinkingEnabled ? "" : null,
        },
      ]);
      placeholderPushed = true;

      await consumeStream(response);
    } catch (error) {
      console.error("advisor stream failed:", error);
      const errorText =
        "Maaf, terjadi kesalahan saat menghubungi AI Advisor. Coba lagi.";
      if (placeholderPushed) {
        // Placeholder sudah ada → tulis error ke pesan terakhir.
        appendToLastMessage({ text: errorText, thinking: "" });
      } else {
        // Belum ada placeholder → push pesan error assistant.
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: errorText },
        ]);
      }
    } finally {
      setIsWaiting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  // Auto-scroll ke bawah setiap kali ada pesan baru / indikator muncul.
  useEffect(() => {
    bodyRef.current?.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isWaiting]);

  return (
    <>
      {/* Wrapper: collapse lebar ke 0 saat tertutup → main content dapat ruang lebih.
          overflow-hidden menyembunyikan panel yang ter-slide keluar layar. */}
      <div
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out lg:block",
          isOpen ? "w-[380px]" : "w-0"
        )}
      >
        <aside
          className={cn(
            "flex h-svh w-[380px] flex-col border-l bg-card transition-transform duration-300 ease-in-out",
            isOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          {/* HEADER */}
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
            AI Financial Advisor
          </h2>
          <p className="text-sm text-muted-foreground">
            Get personalized financial advice.
          </p>
          <p className="text-xs text-muted-foreground">
            {thinkingEnabled
              ? `🧠 Mode: thinking · budget ${BUDGET_LABELS[thinkingBudget]}`
              : "💡 Mode: cepat (Haiku)"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Badge variant="secondary" className="font-normal">
              {apiMessageCount} pesan
            </Badge>
            {apiMessageCount > 8 && (
              <span className="text-xs text-muted-foreground">
                📜 windowing aktif — hanya 10 terakhir dikirim.
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Toggle thinking */}
          <div className="flex items-center gap-1.5">
            <Switch
              id="thinking-toggle"
              checked={thinkingEnabled}
              onCheckedChange={setThinkingEnabled}
              aria-label="Aktifkan thinking"
            />
            <Label
              htmlFor="thinking-toggle"
              className="hidden text-xs text-muted-foreground sm:inline"
            >
              Thinking
            </Label>
          </div>

          {/* Pemilih budget — hanya saat thinking aktif */}
          {thinkingEnabled && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Atur budget thinking"
                >
                  <Settings className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Budget thinking</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={thinkingBudget}
                  onValueChange={(value) =>
                    setThinkingBudget(value as ThinkingBudget)
                  }
                >
                  <DropdownMenuRadioItem value="low">Low</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="medium">
                    Medium
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="high">
                    High
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Reset percakapan — wajib konfirmasi */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Mulai percakapan baru"
              >
                <RotateCcw className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Hapus seluruh riwayat percakapan?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Semua pesan akan dihapus dan percakapan dimulai dari awal.
                  Tindakan ini tidak dapat dibatalkan.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={resetConversation}>
                  Mulai baru
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Separator orientation="vertical" className="h-5" />

          <Button
            variant="ghost"
            size="icon"
            aria-label="Close chat panel"
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* BODY */}
      <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="ml-auto max-w-[85%] rounded-lg bg-emerald-50 px-3 py-2 text-sm text-foreground dark:bg-emerald-950/40"
            >
              {message.content}
            </div>
          ) : (
            <AssistantMessage key={message.id} message={message} />
          )
        )}

        {isWaiting &&
          (thinkingEnabled ? (
            <div className="space-y-1 px-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Brain className="size-4 animate-pulse" />
                <span>Sedang menganalisis...</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Mode thinking aktif — respons mungkin butuh 10-20 detik.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              AI sedang mengetik...
            </div>
          ))}
      </div>

      {/* FOOTER */}
      <div className="border-t p-4">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI Advisor here"
            rows={1}
            disabled={isWaiting}
            className="max-h-32 min-h-9 flex-1 resize-none"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Send message"
            disabled={!canSend}
            onClick={handleSend}
            className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            <Send className="size-4" />
          </Button>
          </div>
        </div>
      </aside>
      </div>

      {/* Floating action button — hanya muncul saat panel tertutup */}
      {!isOpen && (
        <Button
          type="button"
          size="icon"
          aria-label="Open AI Advisor"
          onClick={open}
          className="fixed bottom-6 right-6 z-50 size-12 rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          <MessageCircle className="size-5" />
        </Button>
      )}
    </>
  );
}
