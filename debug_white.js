const puppeteer = require("puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning")
      console.log(`[${msg.type()}]`, msg.text());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (req) =>
    console.log("[reqfail]", req.url(), req.failure()?.errorText)
  );
  page.on("response", (res) => {
    if (res.status() >= 400) console.log("[http]", res.status(), res.url());
  });

  console.log("navigating...");
  await page.goto("http://localhost:19006", { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000));
  const rootHTML = await page.evaluate(() => {
    const r = document.getElementById("root");
    return {
      renderTime: document.querySelector("#root")?.innerHTML?.length,
      hasNifty: (document.body.innerText || "").includes("NIFTY"),
      text: (document.body.innerText || "").slice(0, 200),
    };
  });
  console.log("=== root state ===");
  console.log(JSON.stringify(rootHTML, null, 2));
  await browser.close();
})();
