export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GOOGLE_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API Key not configured" }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { name, history, type, score } = await request.json();
    
    // Construct the prompt
    let prompt = "";
    if (type === 'start') {
      prompt = `You are a supportive teacher. Write a very short (max 15 words) welcoming sentence for ${name}. 
      Context: They have completed ${history.sessionsToday} sessions today and ${history.sessionsYesterday} sessions yesterday. 
      Make it encouraging and fun!`;
    } else {
      prompt = `You are a supportive teacher. Write a very short (max 15 words) congratulatory sentence for ${name}. 
      Context: They just finished a session with a score of ${score.correct}/${score.total}. 
      They have done ${history.sessionsToday} sessions today. 
      Make it warm and motivating!`;
    }

    const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b"]; // 2026 standards
    let lastError = null;

    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 50, temperature: 0.7 }
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error?.message || "Gemini API error");
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text.trim();

        return new Response(JSON.stringify({ text }), {
          headers: { "Content-Type": "application/json" }
        });

      } catch (err) {
        lastError = err;
        console.error(`Model ${model} failed:`, err);
        continue; // Try next model
      }
    }

    throw lastError;

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
