/**
 * LegaLens proxy worker.
 * Deploy with Cloudflare Workers (free tier). Set GEMINI_API_KEY as a secret:
 *   wrangler secret put GEMINI_API_KEY
 * or add it in the Cloudflare dashboard under Settings -> Variables -> Secrets.
 *
 * The browser never sees the API key — it only talks to this worker.
 */

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Restrict which origins can call this worker. Update after you know your
// GitHub Pages URL (e.g. "https://yourname.github.io").
const ALLOWED_ORIGIN = "https://asmita-ai.github.io"; 

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const { systemPrompt, userPrompt, jsonSchema } = body;
    if (!userPrompt) {
      return new Response(JSON.stringify({ error: "userPrompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const generationConfig = { temperature: 0.2 };
    if (jsonSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = jsonSchema;
    }

    const payload = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig,
    };
    if (systemPrompt) {
      payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    try {
      const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await geminiRes.json();

      if (!geminiRes.ok) {
        return new Response(JSON.stringify({ error: "Gemini API error", details: data }), {
          status: geminiRes.status,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

      return new Response(JSON.stringify({ text, raw: data }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Worker error", message: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
  },
};
