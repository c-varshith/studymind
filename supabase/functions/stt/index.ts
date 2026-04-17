const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Accepts JSON { audio: base64, mimeType?: string } and returns { text, words? }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { audio, mimeType = "audio/webm" } = await req.json();
    if (!audio) return new Response(JSON.stringify({ error: "audio required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY not set" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // base64 -> bytes
    const bin = atob(audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });

    const form = new FormData();
    form.append("file", blob, "recording.webm");
    form.append("model_id", "scribe_v2");
    form.append("tag_audio_events", "false");
    form.append("diarize", "false");

    const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("STT error", resp.status, errText);
      return new Response(JSON.stringify({ error: "STT failed", details: errText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    return new Response(JSON.stringify({ text: data.text ?? "", language: data.language_code }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
