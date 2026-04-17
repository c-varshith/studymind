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
    const KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const content = body?.content;
    const count = Number.isFinite(body?.count) ? Math.max(1, Math.min(20, Math.trunc(body.count))) : 10;

    if (typeof content !== "string" || !content.trim()) {
      return new Response(JSON.stringify({ error: "content required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: "Return only valid JSON, no markdown.",
        messages: [
          {
            role: "user",
            content: `Generate ${count} flashcards from this text. Return JSON: {"title":"...","cards":[{"front":"...","back":"..."}]}


${content.slice(0, 12000)}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `AI error: ${resp.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      return new Response(JSON.stringify({ error: "Unexpected AI response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

export {};
