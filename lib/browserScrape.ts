import type {RawHit} from "./types";

const MSEDGE_PATH = process.env.MSEDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const HEADLESS = process.env.BROWSER_HEADLESS !== "false";

interface ScrapeJob {
  q: string;
  channel: RawHit["channel"];
}

function inferChannel(url: string, title: string, snippet: string, fallback: RawHit["channel"]): RawHit["channel"] {
  const text = `${url} ${title} ${snippet}`.toLowerCase();
  if (text.includes("xiaohongshu.com") || text.includes("小红书")) return "xiaohongshu";
  if (text.includes("douyin.com") || text.includes("抖音")) return "douyin";
  if (text.includes("gov.cn") || text.includes("金融监管总局") || text.includes("银保监会") || text.includes("行业协会")) return "authority";
  return fallback;
}

async function loadModule() {
  try {
    const mod = await import("playwright-core");
    return mod.chromium;
  } catch {
    throw new Error("未安装 playwright-core，请运行 npm install playwright-core");
  }
}

export async function scrape360(
  jobs: ScrapeJob[],
  opts?: { headless?: boolean; msEdgePath?: string }
): Promise<RawHit[]> {
  const chromium = await loadModule();
  const executablePath = opts?.msEdgePath || MSEDGE_PATH;
  const headless = opts?.headless ?? HEADLESS;

  const browser = await chromium.launch({
    executablePath,
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    });
    const page = await context.newPage();

    const hits: RawHit[] = [];
    for (const job of jobs) {
      try {
        const url = `https://www.so.com/s?q=${encodeURIComponent(job.q)}`;
        await page.goto(url, {waitUntil: "domcontentloaded", timeout: 25000});
        await page.waitForTimeout(1800);

        // check for verification/captcha
        const body = await page.content();
        if (body.includes("验证码") || body.includes("安全验证") || body.includes("captcha")) {
          console.warn(`[scrape360] captcha detected for: ${job.q}`);
          continue;
        }

        const results = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll("li.res-list"));
          return items.slice(0, 8).map((el) => {
            const titleEl = el.querySelector("h3.res-title a") as HTMLAnchorElement | null;
            const summaryEl = el.querySelector("span.res-list-summary");
            const sourceEl = el.querySelector("a.g-linkinfo-a") as HTMLAnchorElement | null;
            const dataUrl = titleEl?.getAttribute("data-mdurl");
            return {
              title: titleEl?.textContent?.trim() || "",
              url: dataUrl || titleEl?.href || "",
              source: sourceEl?.textContent?.trim() || "360搜索",
              snippet: summaryEl?.textContent?.trim() || "",
            };
          }).filter((x) => x.title && x.url);
        });

        for (const r of results) {
          hits.push({
            title: r.title,
            url: r.url.startsWith("http") ? r.url : `https://www.so.com${r.url}`,
            source: r.source,
            snippet: r.snippet.slice(0, 500),
            channel: inferChannel(r.url, r.title, r.snippet, job.channel),
          });
        }
      } catch (e) {
        console.warn(`[scrape360] error for query ${job.q}:`, e);
      }
    }

    return hits;
  } finally {
    await browser.close();
  }
}

export const browserScrapeJobs: ScrapeJob[] = [
  {q: "保险理赔纠纷 案例 2024", channel: "news"},
  {q: "保险拒赔 诉讼 法院 判决", channel: "news"},
  {q: "重疾险 甲状腺癌 拒赔 理赔", channel: "news"},
  {q: "保险销售误导 退保 损失", channel: "news"},
  {q: "带病投保 两年不可抗辩 理赔", channel: "news"},
  {q: "site:xiaohongshu.com 保险 拒赔 真实", channel: "xiaohongshu"},
  {q: "site:xiaohongshu.com 香港保险 分红", channel: "xiaohongshu"},
  {q: "site:douyin.com 保险 理赔 案例", channel: "douyin"},
  {q: "site:douyin.com 保险 科普 爆款", channel: "douyin"},
  {q: "金融监管总局 保险 最新政策", channel: "authority"},
];
