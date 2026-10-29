import type { GenerationState, ObserverEvent } from "../types.js";

/**
 * Derives the text difference between the previous snapshot and the current snapshot.
 */
export function deriveDelta(
  previous: string,
  current: string
): { kind: "append" | "rewrite"; text: string } {
  if (current.startsWith(previous)) {
    return {
      kind: "append",
      text: current.slice(previous.length),
    };
  }
  return {
    kind: "rewrite",
    text: current,
  };
}

export interface ObserverPollResult {
  events: ObserverEvent[];
  currentState: GenerationState;
  latestText: string;
  isGenerating: boolean;
  hasThinkingDots: boolean;
}

/**
 * Returns the JavaScript source code string to be evaluated inside the page
 * to attach the MutationObserver targeting a specific response index.
 */
export function getInstallObserverScript(targetResponseIndex = 0): string {
  return `
    (() => {
      if (window.__geminiObserver) {
        window.__geminiObserver.disconnect();
      }

      const state = {
        queue: [],
        lastText: "",
        currentState: "SUBMITTING",
        scheduled: false,
        targetIndex: ${targetResponseIndex},
      };

      window.__geminiCapture = state;

      const extractCleanText = (el) => {
        if (!el) return "";
        const md = el.querySelector('.markdown') || el.querySelector('message-content') || el;
        let text = md.innerText ?? md.textContent ?? "";
        // Clean out screen-reader announcement headers if present
        text = text.replace(/^Gemini said\\s*\\n*/i, "");
        return text;
      };

      const readLatest = () => {
        state.scheduled = false;

        const convContainer = document.querySelector('.conversation-container') || document.body;
        const modelResponses = convContainer.querySelectorAll('model-response');

        if (modelResponses.length <= state.targetIndex) {
          const stopBtn = document.querySelector('button[aria-label="Stop response"]');
          const thinkingDots = document.querySelector('thinking-dots-animation');
          if (stopBtn) state.currentState = "GENERATING";
          else if (thinkingDots) state.currentState = "WAITING_FOR_RESPONSE";
          return;
        }

        const targetResponse = modelResponses[state.targetIndex];
        const stopBtn = document.querySelector('button[aria-label="Stop response"]');
        const thinkingDots = targetResponse.querySelector('thinking-dots-animation') || document.querySelector('thinking-dots-animation');

        const presented = targetResponse.querySelector('.presented-response-container') || targetResponse;
        const text = extractCleanText(presented);

        if (text !== state.lastText && text.trim().length > 0) {
          state.lastText = text;
          state.queue.push({
            type: "snapshot",
            text,
            observedAt: Date.now(),
          });
        }

        if (thinkingDots) {
          state.currentState = "WAITING_FOR_RESPONSE";
        } else if (stopBtn) {
          state.currentState = "GENERATING";
        } else if (state.lastText.length > 0) {
          state.currentState = "COMPLETE";
        }
      };

      const root = document.querySelector('.conversation-container') || document.body;
      const observer = new MutationObserver(() => {
        if (state.scheduled) return;
        state.scheduled = true;
        queueMicrotask(readLatest);
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });

      window.__geminiObserver = observer;
      readLatest();
      return true;
    })();
  `;
}

/**
 * Returns the JavaScript source code to drain events and read current observer state.
 */
export function getDrainEventsScript(): string {
  return `
    (() => {
      const state = window.__geminiCapture;
      if (!state) {
        return {
          events: [],
          currentState: "IDLE",
          latestText: "",
          isGenerating: false,
          hasThinkingDots: false,
        };
      }

      const stopBtn = document.querySelector('button[aria-label="Stop response"]');
      const thinkingDots = document.querySelector('thinking-dots-animation');
      const isGenerating = !!stopBtn;
      const hasThinkingDots = !!thinkingDots;

      const events = state.queue.splice(0);
      return {
        events,
        currentState: isGenerating ? "GENERATING" : (hasThinkingDots ? "WAITING_FOR_RESPONSE" : state.currentState),
        latestText: state.lastText,
        isGenerating,
        hasThinkingDots,
      };
    })();
  `;
}

/**
 * Returns the JavaScript source code to clean up the observer.
 */
export function getCleanupObserverScript(): string {
  return `
    (() => {
      if (window.__geminiObserver) {
        window.__geminiObserver.disconnect();
        delete window.__geminiObserver;
      }
      delete window.__geminiCapture;
      return true;
    })();
  `;
}
