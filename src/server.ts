import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { GeminiAdapter } from "./adapter/gemini-adapter.js";
import { RequestQueue } from "./queue.js";
import {
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  type ModelListResponse,
} from "./types.js";

const PORT = Number(process.env.PORT || 6331);
const API_KEY = process.env.API_KEY || "sk-gemini-scrapi-local";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120000);

const app = new Hono();
const queue = new RequestQueue(1);
const adapter = new GeminiAdapter();

// Initialize the browser adapter in the background
adapter.init().catch((err) => {
  console.error("Failed to initialize Gemini adapter during startup:", err);
});

app.use("*", logger());
app.use("*", cors());

// Authentication Middleware
app.use("/v1/*", async (c, next) => {
  if (!API_KEY) return next();

  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(
      {
        error: {
          message: "Missing Authorization header",
          type: "invalid_request_error",
          code: "unauthorized",
        },
      },
      401
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token !== API_KEY) {
    return c.json(
      {
        error: {
          message: "Invalid API key",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      401
    );
  }

  return next();
});

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    queue: {
      pending: queue.pending,
      active: queue.active,
    },
    timestamp: Date.now(),
  });
});

// List Models (/v1/models)
app.get("/v1/models", async (c) => {
  try {
    const models = await adapter.getAvailableModels();
    const response: ModelListResponse = {
      object: "list",
      data: models,
    };
    return c.json(response);
  } catch (err: any) {
    return c.json(
      {
        error: {
          message: err?.message || "Failed to retrieve models",
          type: "api_error",
        },
      },
      500
    );
  }
});

// Chat Completions (/v1/chat/completions)
app.post("/v1/chat/completions", async (c) => {
  let bodyJson: unknown;
  try {
    bodyJson = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          message: "Invalid JSON in request body",
          type: "invalid_request_error",
        },
      },
      400
    );
  }

  const parseResult = ChatCompletionRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return c.json(
      {
        error: {
          message: parseResult.error.message,
          type: "invalid_request_error",
          param: parseResult.error.issues,
        },
      },
      400
    );
  }

  const body = parseResult.data;
  const requestId = `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);

  // Format prompt from messages
  let promptText = "";
  const firstMessage = body.messages[0];
  if (body.messages.length === 1 && firstMessage && firstMessage.role === "user") {
    promptText = firstMessage.content;
  } else {
    promptText = body.messages
      .map((m) => {
        if (m.role === "system") return `[System Instructions: ${m.content}]`;
        if (m.role === "assistant") return `Assistant: ${m.content}`;
        return `User: ${m.content}`;
      })
      .join("\n\n");
  }

  // Handle Streaming Responses
  if (body.stream) {
    return streamSSE(c, async (stream) => {
      const abortController = new AbortController();

      stream.onAbort(() => {
        abortController.abort();
      });

      try {
        await queue.enqueue(async () => {
          // Initial chunk with role
          await stream.writeSSE({
            data: JSON.stringify({
              id: requestId,
              object: "chat.completion.chunk",
              created,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            }),
          });

          await adapter.submitPrompt(promptText, {
            model: body.model,
            signal: abortController.signal,
            timeoutMs: REQUEST_TIMEOUT_MS,
            resetChat: true,
            onChunk: async (delta) => {
              if (delta) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    id: requestId,
                    object: "chat.completion.chunk",
                    created,
                    model: body.model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: delta },
                        finish_reason: null,
                      },
                    ],
                  }),
                });
              }
            },
          });

          // Final closing chunk
          await stream.writeSSE({
            data: JSON.stringify({
              id: requestId,
              object: "chat.completion.chunk",
              created,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            }),
          });

          await stream.writeSSE({ data: "[DONE]" });
        }, abortController.signal);
      } catch (err: any) {
        if (!abortController.signal.aborted) {
          await stream.writeSSE({
            data: JSON.stringify({
              error: {
                message: err?.message || "Generation error occurred",
                type: "api_error",
              },
            }),
          });
        }
      }
    });
  }

  // Handle Non-Streaming Responses
  const abortController = new AbortController();
  try {
    const responseText = await queue.enqueue(async () => {
      return await adapter.submitPrompt(promptText, {
        model: body.model,
        signal: abortController.signal,
        timeoutMs: REQUEST_TIMEOUT_MS,
        resetChat: true,
      });
    }, abortController.signal);

    const response: ChatCompletionResponse = {
      id: requestId,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: responseText,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(promptText.length / 4),
        completion_tokens: Math.ceil(responseText.length / 4),
        total_tokens: Math.ceil((promptText.length + responseText.length) / 4),
      },
    };

    return c.json(response);
  } catch (err: any) {
    return c.json(
      {
        error: {
          message: err?.message || "Internal server error",
          type: "api_error",
        },
      },
      500
    );
  }
});

// Graceful cleanup on shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server and closing browser...");
  await adapter.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nTerminating server and closing browser...");
  await adapter.close();
  process.exit(0);
});

console.log(`Gemini OpenAI-compatible server running on http://localhost:${PORT}`);
console.log(`API Key: ${API_KEY}`);

export default {
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 255,
};
