import path from "node:path";
import fs from "node:fs";
import { Camoufox } from "camoufox-js";
import type { Browser, BrowserContext, Page } from "playwright-core";
import {
  deriveDelta,
  getInstallObserverScript,
  getDrainEventsScript,
  getCleanupObserverScript,
  type ObserverPollResult,
} from "./observer.js";
import type { ModelObject } from "../types.js";

export interface AdapterOptions {
  headless?: boolean;
  humanize?: boolean;
  profileDir?: string;
  cookiesPath?: string;
  geminiUrl?: string;
}

export class GeminiAdapter {
  private browser: any | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isReady = false;
  private options: AdapterOptions;

  constructor(options: AdapterOptions = {}) {
    this.options = {
      headless: options.headless ?? (process.env.HEADLESS === "true"),
      humanize: options.humanize ?? true,
      profileDir: options.profileDir ?? process.env.CAMOUFOX_PROFILE_DIR,
      cookiesPath: options.cookiesPath ?? path.resolve(process.cwd(), "cookies.json"),
      geminiUrl: options.geminiUrl ?? process.env.GEMINI_URL ?? "https://gemini.google.com/app",
    };
  }

  public async init(): Promise<void> {
    if (this.isReady && this.page && !this.page.isClosed()) {
      return;
    }

    const camoufoxArgs: Record<string, any> = {
      headless: this.options.headless,
      humanize: this.options.humanize,
    };

    if (this.options.profileDir && fs.existsSync(this.options.profileDir)) {
      camoufoxArgs.user_data_dir = this.options.profileDir;
    }

    this.browser = await Camoufox(camoufoxArgs);

    if (typeof this.browser.newContext === "function") {
      this.context = await this.browser.newContext();
    } else {
      this.context = this.browser as BrowserContext;
    }

    // Load cookies if available
    await this.loadCookies();

    const existingPages = this.context!.pages();
    this.page = existingPages[0] ?? (await this.context!.newPage());

    await this.page.goto(this.options.geminiUrl!, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    // Wait for the prompt input or container
    await this.page.waitForSelector(".ql-editor, rich-textarea", {
      timeout: 25000,
    }).catch(() => {
      console.warn("Input element not found immediately, page may still be loading.");
    });

    this.isReady = true;
  }

  private async loadCookies(): Promise<void> {
    if (!this.context || !this.options.cookiesPath) return;

    if (!fs.existsSync(this.options.cookiesPath)) {
      console.warn(`Cookies file not found at: ${this.options.cookiesPath}`);
      return;
    }

    try {
      const raw = fs.readFileSync(this.options.cookiesPath, "utf-8");
      const cookieList = JSON.parse(raw);

      if (!Array.isArray(cookieList)) return;

      const normalized = cookieList.map((c) => {
        let sameSite: "Strict" | "Lax" | "None" | undefined;
        if (c.sameSite === "strict" || c.sameSite === "Strict") sameSite = "Strict";
        else if (c.sameSite === "lax" || c.sameSite === "Lax") sameSite = "Lax";
        else if (c.sameSite === "no_restriction" || c.sameSite === "None") sameSite = "None";

        const cookie: any = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || "/",
          httpOnly: Boolean(c.httpOnly),
          secure: Boolean(c.secure),
        };
        if (sameSite) cookie.sameSite = sameSite;
        if (c.expirationDate && !c.session) {
          cookie.expires = Math.floor(c.expirationDate);
        }
        return cookie;
      });

      await this.context.addCookies(normalized);
      console.log(`Loaded ${normalized.length} cookies into browser context.`);
    } catch (err) {
      console.error("Failed to load cookies:", err);
    }
  }

  public async getAvailableModels(): Promise<ModelObject[]> {
    await this.ensureReady();
    const page = this.page!;

    const defaultFallbackModels: ModelObject[] = [
      { id: "3.5 Flash-Lite", object: "model", created: Date.now(), owned_by: "google", description: "Fastest answers" },
      { id: "3.6 Flash", object: "model", created: Date.now(), owned_by: "google", description: "All-around help" },
      { id: "3.8 Flash", object: "model", created: Date.now(), owned_by: "google", description: "Next-gen Flash" },
      { id: "3.1 Pro", object: "model", created: Date.now(), owned_by: "google", description: "Advanced reasoning" },
      { id: "4 Argon", object: "model", created: Date.now(), owned_by: "google", description: "Complex tasks" },
    ];

    try {
      const modeBtn = await page.$('button[data-test-id="bard-mode-menu-button"]');
      if (!modeBtn) {
        return defaultFallbackModels;
      }

      await modeBtn.click();
      await page.waitForSelector('.cdk-overlay-container [role="menuitem"]', { timeout: 3000 }).catch(() => {});

      const discovered = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"]'));
        return items
          .map((el) => {
            const htmlEl = el as HTMLElement;
            const raw = htmlEl.innerText || htmlEl.textContent || "";
            const lines = raw.split("\n").map((s: string) => s.trim()).filter(Boolean);
            if (lines.length === 0 || !lines[0] || lines[0].includes("Sign in")) return null;
            return {
              id: lines[0],
              description: lines.slice(1).join(" - "),
            };
          })
          .filter(Boolean);
      });

      // Close menu
      await page.evaluate(() => {
        const backdrop = document.querySelector('.cdk-overlay-backdrop') as HTMLElement;
        if (backdrop) backdrop.click();
      }).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});

      if (discovered && discovered.length > 0) {
        const now = Date.now();
        const map = new Map<string, ModelObject>();
        for (const m of defaultFallbackModels) {
          map.set(m.id.toLowerCase(), m);
        }
        for (const d of discovered as any[]) {
          map.set(d.id.toLowerCase(), {
            id: d.id,
            object: "model",
            created: now,
            owned_by: "google",
            description: d.description,
          });
        }
        return Array.from(map.values());
      }
    } catch (err) {
      console.warn("Could not dynamically inspect models, using defaults:", err);
    }

    return defaultFallbackModels;
  }

  public async selectModel(modelName: string): Promise<boolean> {
    await this.ensureReady();
    const page = this.page!;

    try {
      const modeBtn = await page.$('button[data-test-id="bard-mode-menu-button"]');
      if (!modeBtn) return false;

      const currentText = await modeBtn.innerText().catch(() => "");
      if (currentText.toLowerCase().includes(modelName.toLowerCase())) {
        return true;
      }

      await modeBtn.click();
      await page.waitForSelector('.cdk-overlay-container [role="menuitem"]', { timeout: 3000 }).catch(() => {});

      const clicked = await page.evaluate((target: string) => {
        const items = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"]'));
        const match = items.find((item) => {
          const htmlEl = item as HTMLElement;
          const txt = (htmlEl.innerText || htmlEl.textContent || "").toLowerCase();
          return txt.includes(target.toLowerCase());
        });
        if (match) {
          (match as HTMLElement).click();
          return true;
        }
        return false;
      }, modelName);

      if (!clicked) {
        await page.evaluate(() => {
          const backdrop = document.querySelector('.cdk-overlay-backdrop') as HTMLElement;
          if (backdrop) backdrop.click();
        }).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
      }
      return clicked;
    } catch {
      await page.evaluate(() => {
        const backdrop = document.querySelector('.cdk-overlay-backdrop') as HTMLElement;
        if (backdrop) backdrop.click();
      }).catch(() => {});
      return false;
    }
  }

  public async startNewChat(): Promise<void> {
    await this.ensureReady();
    const page = this.page!;

    // Dismiss any overlays or menus
    await page.evaluate(() => {
      const backdrops = document.querySelectorAll('.cdk-overlay-backdrop');
      backdrops.forEach((b) => (b as HTMLElement).click());
    }).catch(() => {});

    // Check if we are already on a fresh page
    const currentUrl = page.url();
    if (currentUrl.endsWith("/app") || currentUrl.endsWith("/app/")) {
      const msgCount = await page.evaluate(() => document.querySelectorAll('model-response').length).catch(() => 0);
      if (msgCount === 0) {
        return;
      }
    }

    // Direct navigation to clean app route
    await page.goto(this.options.geminiUrl!, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForSelector(".ql-editor", { timeout: 15000 }).catch(() => {});
  }

  public async submitPrompt(
    prompt: string,
    options: {
      model?: string;
      onChunk?: (delta: string, snapshot: string) => void | Promise<void>;
      signal?: AbortSignal;
      timeoutMs?: number;
      resetChat?: boolean;
    } = {}
  ): Promise<string> {
    await this.ensureReady();
    const page = this.page!;
    const timeoutMs = options.timeoutMs ?? 120000;

    if (options.resetChat) {
      await this.startNewChat();
    }

    if (options.model) {
      await this.selectModel(options.model);
    }

    // Wait for the Quill editor
    await page.waitForSelector(".ql-editor", { timeout: 15000 });

    // Focus and insert text using execCommand (bypasses TrustedHTML CSP)
    await page.evaluate((text) => {
      const editor = document.querySelector(".ql-editor") as HTMLElement;
      if (!editor) throw new Error("Editor element not found");
      editor.focus();
      document.execCommand("selectAll", false, undefined);
      document.execCommand("delete", false, undefined);
      document.execCommand("insertText", false, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }, prompt);

    await page.waitForTimeout(300);

    // Count current responses so we track exactly this turn
    const targetTurnIndex = await page.evaluate(() => {
      return document.querySelectorAll('model-response').length;
    });

    // Install the DOM observer for this specific turn
    await page.evaluate(getInstallObserverScript(targetTurnIndex));

    // Submit by clicking the send button or pressing Enter
    const sendButton = await page.$('button[aria-label="Send message"]');
    if (sendButton) {
      await page.evaluate((btn) => (btn as HTMLElement).click(), sendButton).catch(() => {});
    } else {
      await page.keyboard.press("Enter");
    }

    // Monitor response generation
    const startTime = Date.now();
    let previousText = "";
    let finalOutput = "";
    let completed = false;

    // Handle external abort signal
    if (options.signal) {
      options.signal.addEventListener("abort", async () => {
        try {
          const stopBtn = await page.$('button[aria-label="Stop response"]');
          if (stopBtn) await stopBtn.click();
        } catch {
          // Ignore abort errors
        }
      });
    }

    // Allow prompt to dispatch and initial generation to start
    await page.waitForTimeout(400);

    while (Date.now() - startTime < timeoutMs) {
      if (options.signal?.aborted) {
        throw new Error("Request aborted by client");
      }

      const poll: ObserverPollResult = await page.evaluate(getDrainEventsScript());

      // If we received snapshot updates
      if (poll.latestText && poll.latestText !== previousText) {
        const delta = deriveDelta(previousText, poll.latestText);
        previousText = poll.latestText;
        finalOutput = poll.latestText;

        if (options.onChunk && delta.text) {
          await options.onChunk(delta.text, poll.latestText);
        }
      }

      // Check termination conditions:
      // Response is complete when Stop response button is gone, thinking dots are gone,
      // and we have non-empty text, or state was marked COMPLETE.
      if (!poll.isGenerating && !poll.hasThinkingDots && finalOutput.length > 0) {
        // Wait another 300ms to ensure final DOM characterData updates settle
        await page.waitForTimeout(300);
        const finalPoll: ObserverPollResult = await page.evaluate(getDrainEventsScript());
        if (finalPoll.latestText && finalPoll.latestText !== previousText) {
          const delta = deriveDelta(previousText, finalPoll.latestText);
          if (options.onChunk && delta.text) {
            await options.onChunk(delta.text, finalPoll.latestText);
          }
          finalOutput = finalPoll.latestText;
        }
        completed = true;
        break;
      }

      await page.waitForTimeout(60);
    }

    // Cleanup observer
    await page.evaluate(getCleanupObserverScript()).catch(() => {});

    if (!completed && finalOutput.length === 0) {
      throw new Error(`Generation timed out after ${timeoutMs}ms without response.`);
    }

    return finalOutput;
  }

  private async ensureReady(): Promise<void> {
    if (!this.isReady || !this.page || this.page.isClosed()) {
      await this.init();
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser && typeof this.browser.close === "function") {
        await this.browser.close().catch(() => {});
      }
    } finally {
      this.isReady = false;
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }
}
