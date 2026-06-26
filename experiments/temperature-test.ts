import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PROMPT = "Berikan satu nama unik untuk celengan digital.";
const TEMPERATURES = [0.0, 0.5, 1.0];
const ATTEMPTS = 2;

async function ask(temperature: number): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 100,
    temperature,
    messages: [{ role: "user", content: PROMPT }],
  });

  const block = response.content[0];
  return block && block.type === "text" ? block.text : "(bukan teks)";
}

async function main() {
  for (const temperature of TEMPERATURES) {
    console.log(`--- temperature: ${temperature.toFixed(1)} ---`);
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const answer = await ask(temperature);
      console.log(`Attempt ${attempt}: ${answer}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
