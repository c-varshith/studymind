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

const VOICES: Record<string, string> = {
  sarah: "EXAVITQu4vr4xnSDxMaL",
  george: "JBFqnCBsd6RMkjVDRZzb",
  charlie: "IKne3meq5aSn9XLyUdCD",
  alice: "Xb7hH8MSUJpSbSDYk0k2",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { text, voice = "sarah" } = await req.json();
    if (!text) return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY not set" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const voiceId = VOICES[voice] ?? VOICES.sarah;
    const trimmed = String(text).slice(0, 4500);

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmed,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("TTS error", resp.status, errText);
      return new Response(JSON.stringify({ error: "TTS failed", details: errText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(resp.body, { headers: { ...corsHeaders, "Content-Type": "audio/mpeg" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

export {};
