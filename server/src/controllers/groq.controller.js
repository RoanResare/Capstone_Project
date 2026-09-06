const {
  createChatCompletion,
  createChatCompletionStream,
  createFallbackChunk,
  getGroqStatus,
} = require("../services/groq.service");

const FALLBACK_STREAM_MESSAGE =
  "Sorry, I could not connect to live chat right now. Please try again in a moment.";

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
  res.status(status.ready ? 200 : 500).json(status);
}

async function createGroqChat(req, res) {
  const wantsStream = req.body?.stream === true;

  if (!wantsStream) {
    const result = await createChatCompletion(req.body || {});
    res.status(200).json(result);
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
    writeSseChunk(res, createFallbackChunk(FALLBACK_STREAM_MESSAGE));
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

module.exports = {
  createGroqChat,
  getGroqRuntimeStatus,
};
