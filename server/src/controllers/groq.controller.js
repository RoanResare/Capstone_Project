const {
  createChatCompletion,
  createChatCompletionStream,
  createFallbackChunk,
  getGroqStatus,
} = require("../services/groq.service");

const FALLBACK_STREAM_MESSAGE =
  "Sorry, I could not connect to live chat right now. Please try again in a moment.";
const OUT_OF_SCOPE_MESSAGE =
  "I can only help with Charming Fur-fection pet care services, appointments, prices, clinic hours, policies, and customer account guidance.";

function isRelevantPetCareSystemQuestion(message = "") {
  const value = String(message || "").trim().toLowerCase();
  if (!value) return false;
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b/.test(value)) return true;
  return /\b(pet|dog|cat|puppy|kitten|clinic|vet|veterinary|groom|grooming|bath|blowdry|service|price|rate|cost|fee|appointment|book|booking|schedule|slot|hours|location|branch|las pinas|las piñas|vaccin|rabies|deworm|consultation|laboratory|cbc|chemistry|urinalysis|kapon|neuter|spay|account|dashboard|profile|record|policy|cancel|reminder)\b/.test(value);
}

function writeSseChunk(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function startSseResponse(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

async function getGroqRuntimeStatus(_req, res) {
  const status = getGroqStatus();
  res.status(200).json(status);
}

async function createGroqChat(req, res) {
  const wantsStream = req.body?.stream === true;
  const message = req.body?.message || "";

  if (!isRelevantPetCareSystemQuestion(message)) {
    if (wantsStream) {
      startSseResponse(res);
      writeSseChunk(res, createFallbackChunk(OUT_OF_SCOPE_MESSAGE, {
        model: null,
        provider: "guardrail",
        warning: "Message blocked because it is outside the pet care services system context.",
      }));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.status(200).json({
      answer: OUT_OF_SCOPE_MESSAGE,
      model: null,
      provider: "guardrail",
      warning: "Message blocked because it is outside the pet care services system context.",
    });
    return;
  }

  if (!wantsStream) {
    try {
      const result = await createChatCompletion(req.body || {});
      res.status(200).json(result);
    } catch (error) {
      console.error("[groq] Returning fallback chat response.", {
        error: error instanceof Error ? error.message : String(error || "Unknown error"),
        statusCode: error?.statusCode || error?.status || null,
      });
      res.status(200).json({
        answer: FALLBACK_STREAM_MESSAGE,
        model: null,
        provider: "fallback",
        warning: error instanceof Error ? error.message : "Groq request failed.",
      });
    }
    return;
  }

  startSseResponse(res);

  try {
    await createChatCompletionStream(req.body || {}, (chunk) => {
      writeSseChunk(res, chunk);
    });
  } catch (error) {
    console.error("[groq] Returning fallback stream response.", {
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
      statusCode: error?.statusCode || error?.status || null,
    });
    writeSseChunk(
      res,
      createFallbackChunk(FALLBACK_STREAM_MESSAGE, {
        model: null,
        provider: "fallback",
        warning: error instanceof Error ? error.message : "Groq request failed.",
      }),
    );
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

module.exports = {
  createGroqChat,
  getGroqRuntimeStatus,
};
