import { chromium } from "playwright-core";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const requestedThreads = process.env.WHISPER_THREADS;
const appBaseUrl = process.env.WHISPER_APP_URL ?? "http://127.0.0.1:24680/";
const appUrl = requestedThreads
  ? `${appBaseUrl}${appBaseUrl.includes("?") ? "&" : "?"}whispercppThreads=${requestedThreads}`
  : appBaseUrl;
const audioPath =
  process.env.WHISPER_TEST_AUDIO ??
  "C:\\Users\\utente\\Desktop\\whisperwebui\\Semiotica1 M5L5 [MpNSz4a4Pk8].mp3";
const audioName = path.basename(audioPath);
const modelId = process.env.WHISPER_MODEL ?? "wc-tiny-q5";
const language = process.env.WHISPER_LANGUAGE ?? "it";

async function waitForWorkerOnline(page, timeout = 30000) {
  await page.waitForFunction(
    () => document.body?.innerText.includes("Worker is online."),
    undefined,
    { timeout }
  );
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
  const workerLogs = [];
  page.on("console", (msg) => {
    console.log("[browser console]", msg.type(), msg.text());
    workerLogs.push(msg.text());
  });

  console.log("Opening", appUrl);
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await waitForWorkerOnline(page);
  console.log("Whisper.cpp worker online");

  await page.locator("#language").selectOption(language);
  await page.locator("#model").selectOption(modelId);

  const installButton = page.getByRole("button", { name: "Install selected model" });
  if (await installButton.isEnabled()) {
    await installButton.click();
    console.log("Started whisper.cpp model download");

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
    console.log("Selected model already installed");
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

  const startedAt = Date.now();
  await startButton.click();
  console.log("Transcription started");

  const transcriptBox = page.locator(".transcript-box");
  await page.waitForFunction(
    (el) => Boolean(el instanceof HTMLTextAreaElement && el.value.trim().length > 0),
    await transcriptBox.elementHandle(),
    { timeout: 300000 }
  );

  const transcript = ((await transcriptBox.inputValue()) ?? "").trim();
  const elapsedMs = Date.now() - startedAt;
  const systemInfoLine = workerLogs.find((line) => line.includes("system_info:")) ?? "not found";
  console.log("Transcript length:", transcript.length);
  console.log("Transcript preview:", transcript.slice(0, 200));
  console.log("Elapsed ms:", elapsedMs);
  console.log("System info:", systemInfoLine);
} finally {
  await browser.close();
}
