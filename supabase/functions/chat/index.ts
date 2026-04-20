declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { messages, noteContext } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

    const system = `You are StudyMind, a friendly, focused study tutor. Explain concepts clearly, use short paragraphs, lists, and analogies. Use markdown.${
      noteContext ? `\n\nThe user is studying these notes. Ground your answers in this material when relevant:\n---\n${String(noteContext).slice(0, 12000)}\n---` : ""
    }`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        stream: true,
        system,
        messages,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Anthropic error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI error: " + resp.status }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-stream in OpenAI SSE format (what the frontend expects)
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const reader = resp.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (json === "[DONE]") continue;
            try {
              const ev = JSON.parse(json);
              if (ev.type === "content_block_delta") {
                const chunk = JSON.stringify({ choices: [{ delta: { content: ev.delta?.text ?? "" } }] });
                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
              }
            } catch {
              continue;
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

export {};