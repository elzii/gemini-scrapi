import { z } from "zod";

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatCompletionRequestSchema = z.object({
  model: z.string().default("3.5 Flash-Lite"),
  messages: z.array(ChatMessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "content_filter" | "abort";
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: "assistant";
    content?: string;
  };
  finish_reason: "stop" | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: "google";
  description?: string;
}

export interface ModelListResponse {
  object: "list";
  data: ModelObject[];
}

export type GenerationState =
  | "IDLE"
  | "SUBMITTING"
  | "WAITING_FOR_RESPONSE"
  | "GENERATING"
  | "COMPLETE"
  | "ERROR";

export interface ObserverEvent {
  type: "snapshot" | "state";
  text?: string;
  state?: GenerationState;
  observedAt: number;
}
