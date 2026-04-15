import { chromium } from "playwright-core";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const appUrl = process.env.WHISPER_APP_URL ?? "http://127.0.0.1:24682/";
const audioPath =
  process.env.WHISPER_TEST_AUDIO ??
  "C:\\Users\\utente\\Desktop\\whisperwebui\\Semiotica1 M5L5 [MpNSz4a4Pk8].mp3";
const audioName = path.basename(audioPath);

async function waitForWorkerOnline(page, timeout = 30000) {
  await page.waitForFunction(
    () => document.body?.innerText.includes("Worker is online."),
    undefined,
    { timeout }
  );
}

async function waitForEnabled(locator, timeout = 30000) {
  await locator.waitFor({ state: "visible", timeout });
  await page.waitForFunction((el) => !el.disabled, await locator.elementHandle(), { timeout });
}

let page;

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"]
});

try {
  const context = await browser.newContext();
  page = await context.newPage();
  page.on("console", (msg) => {
    console.log("[browser console]", msg.type(), msg.text());
  });

  console.log("Opening", appUrl);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await waitForWorkerOnline(page);
  console.log("Main worker online");

  await page.locator("#backend").selectOption("whispercpp");
  await waitForWorkerOnline(page);
  console.log("whisper.cpp worker online");

  await page.locator("#language").selectOption("it");
  await page.locator("#model").selectOption("wc-tiny-q5");

  const installButton = page.getByRole("button", { name: "Install selected model" });
  if (await installButton.isEnabled()) {
    await installButton.click();
    console.log("Started whisper.cpp Tiny download");

    const started = Date.now();
    let sawNonZeroProgress = false;
    while (Date.now() - started < 120000) {
      const percentText = ((await page.locator(".run-percent").textContent()) ?? "").trim();
      console.log("Progress:", percentText);
      const match = percentText.match(/(\d+)%/);
      if (match && Number(match[1]) > 0) {
        sawNonZeroProgress = true;
      }
      if (await page.getByRole("button", { name: "Remove" }).first().isVisible()) {
        console.log("Model installed");
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!sawNonZeroProgress) {
      throw new Error("Progress never moved above 0% during model download.");
    }
  } else {
    console.log("Selected whisper.cpp model already installed");
  }

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(audioPath);
  await page.waitForFunction(
    (name) => document.body?.innerText.includes(name),
    audioName,
    { timeout: 30000 }
  );
  console.log("Audio file loaded:", audioName);

  const startButton = page.getByRole("button", { name: "Start transcription" });
  await startButton.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction((el) => !el.disabled, await startButton.elementHandle(), {
    timeout: 60000
  });

  await startButton.click();
  console.log("Transcription started");

  const transcriptBox = page.locator(".transcript-box");
  await page.waitForFunction(
    (el) => Boolean(el instanceof HTMLTextAreaElement && el.value.trim().length > 0),
    await transcriptBox.elementHandle(),
    { timeout: 300000 }
  );

  const transcript = ((await transcriptBox.inputValue()) ?? "").trim();
  console.log("Transcript length:", transcript.length);
  console.log("Transcript preview:", transcript.slice(0, 200));
} finally {
  await browser.close();
}
