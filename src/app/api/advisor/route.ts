import { ADVISOR_SYSTEM } from "@/features/prompts";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Instruksi format ditempel ke depan pesan user (pola "prompt prefixing"),
// bukan lewat parameter system.
// const INSTRUCTION_PREFIX = `Anda menjawab dalam Bahasa Indonesia, ramah dan to-the-point. Pakai markdown: list bertanda untuk poin, bold untuk angka penting. Format Rupiah: "Rp 1.500.000". Persentase: "15%".

//Pertanyaan: `;

type ChatMessage = { role: "user" | "assistant"; content: string };

type AdvisorBody = {
  messages?: ChatMessage[];
  thinking?: boolean;
  budget?: "low" | "medium" | "high";
};

export async function POST(request: Request) {
  const body: AdvisorBody | null = await request.json().catch(() => null);
  const messages = body?.messages;

  // messages wajib array non-kosong.
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("messages harus array non-kosong", { status: 400 });
  }

  // Setiap pesan harus role "user" atau "assistant" (bukan "system") + content string.
  const allValid = messages.every(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string",
  );
  if (!allValid) {
    return new Response(
      "Setiap pesan harus role 'user' atau 'assistant'",
      { status: 400 },
    );
  }

  // Pesan terakhir harus dari user (giliran yang sedang dijawab).
  const last = messages[messages.length - 1];
  if (last.role !== "user" || !last.content.trim()) {
    return new Response("Pesan terakhir harus dari user dan tidak kosong", {
      status: 400,
    });
  }

  const thinking = body?.thinking === true;
  const budget = body?.budget;

  // Safety net: kirim hanya 10 pesan terakhir ke API (hemat token). Pesan lebih
  // lama tetap ada di client state, hanya tidak ikut dikirim.
  const recentMessages = messages.slice(-10);

  // INSTRUCTION_PREFIX dipasang HANYA di pesan user terakhir, bukan di tiap pesan.
  const apiMessages: ChatMessage[] = recentMessages.map((m, i) =>
    i === recentMessages.length - 1
      ? { role: m.role, content: m.content }
      : { role: m.role, content: m.content },
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Branching model:
        // - thinking on  → Opus 4.7 + adaptive thinking, tanpa temperature.
        // - thinking off → Haiku 4.5 (hemat) + temperature 0.5.
        const apiStream = thinking
          ? anthropic.messages.stream({
              model: "claude-opus-4-7",
              max_tokens: 16000,
              thinking: { type: "adaptive", display: "summarized" },
              output_config: { effort: budget ?? "max" },
              messages: apiMessages,
            })
          : anthropic.messages.stream({
              model: "claude-haiku-4-5",
              max_tokens: 1024,
              temperature: 0.5,
              system: ADVISOR_SYSTEM,
              stop_sequences: ['[Selesai]'],
              messages: apiMessages,
            });

        for await (const chunk of apiStream) {
          if (chunk.type !== "content_block_delta") continue;

          if (chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text));
          } else if (chunk.delta.type === "thinking_delta") {
            // Bungkus thinking dengan penanda agar client bisa membedakannya
            // dari teks jawaban biasa.
            controller.enqueue(
              encoder.encode(
                `[[THINKING_DELTA]]${chunk.delta.thinking}[[/THINKING_DELTA]]`,
              ),
            );
          }
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
