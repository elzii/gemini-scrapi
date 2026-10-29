#!/usr/bin/env node

import process from "node:process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Camoufox } from "camoufox-js";

const [, , ...args] = process.argv;
let flags = new Map()

let query = args.join(" ") || "foo"

if ( query.includes('--debug') ) {
  query = query.replace('--debug', '').trim()
}

const DEBUG = (process.env.DEBUG === "true" || flags.get('debug')) ?? false;

const BASE_URL = "https://www.imdb.com/calendar"
const WAIT_FOR_SELECTOR = true
const WAITING_SELECTOR = "body" 
const params = new URLSearchParams({
  region: "US",
  type: "TV",
  ref_: "rlm",
});


const PROFILE_DIR = path.join(
  os.homedir(),
  "Library/Application Support/camoufox/Profiles/2jpccw9p.default-default"
);


export async function results(
  camoufoxOptions = {
    user_data_dir: PROFILE_DIR,
    headless: true,
    humanize: true,
  },
  shouldScroll = true,
) {
  const TARGET_URL = params.size > 0 
    ? `${BASE_URL}?${params.toString()}`
    : `${BASE_URL}`

  const context = await Camoufox({
    ...camoufoxOptions,
  });  try {
    DEBUG && process.stderr.write(`Opening Camoufox page ...\n`);
    const page = context.pages()[0] ?? (await context.newPage());

    DEBUG && process.stderr.write(`Navigating to '${TARGET_URL}' ...\n`);
    await page.goto(TARGET_URL, { waitUntil: "networkidle" });


    if ( WAIT_FOR_SELECTOR ) {
      DEBUG && process.stderr.write(`Page loaded. Waiting for selector '${WAITING_SELECTOR}'...\n`);
      // Wait for the grid container to appear
      await page
        .waitForSelector(WAITING_SELECTOR, { timeout: 10000 })
        .catch(() => {});
    }

// Wait for network requests triggered by scroll to finish
    DEBUG && process.stderr.write(`Waiting for 'networkidle' ...\n`);
    await page.waitForLoadState("networkidle").catch(() => {});

    if ( shouldScroll ) {
      DEBUG && process.stderr.write(`Scrolling to bottom of page (2s) [START] ...\n`);
      // Scroll to the bottom and wait for any lazy-loaded content to settle
      await page.evaluate(async () => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
        // Wait for scroll animation and DOM updates
        await new Promise((resolve) => setTimeout(resolve, 2000));
      });
      DEBUG && process.stderr.write(`Scrolling to bottom of page (2s) [FINISH] ...\n`);
    }    
    // Extract item details
    const items = await page.evaluate(() => {
      return [...document.querySelectorAll('body div')].map(n => {
        return {
          divContent: n.textContent?.trim() || "",
        }
      })
    })

    console.log(JSON.stringify(items, null, 2));

    return items;
  } finally {
    await context.close();
  }
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  results();
}
