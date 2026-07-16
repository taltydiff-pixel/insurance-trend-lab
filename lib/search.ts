import {XMLParser} from "fast-xml-parser";
import type {RawHit} from "./types";
import {scrape360, browserScrapeJobs} from "./browserScrape";

const queries = [
  // 权威机构 / 监管
  {q: "保险 监管 政策 金融监管总局", channel: "authority" as const},
  {q: "保险 养老 金融 最新", channel: "authority" as const},
  // 案例 / 诉讼 / 理赔纠纷
  {q: "保险 拒赔 诉讼 案例", channel: "news" as const},
  {q: "保险 理赔 纠纷 判决", channel: "news" as const},
  {q: "保险 销售误导 退保 损失", channel: "news" as const},
  {q: "重疾险 甲状腺癌 拒赔 法院", channel: "news" as const},
  {q: "意外险 猝死 免责条款 争议", channel: "news" as const},
  {q: "医疗险 带病投保 理赔纠纷", channel: "news" as const},
  // 市场 / 产品
  {q: " Insurance Hong Kong 分红险 储蓄险", channel: "news" as const},
  {q: "增额终身寿 降息 下架", channel: "news" as const},
  // 社交平台公开索引线索
  {q: "site:douyin.com 保险 理赔 案例", channel: "douyin" as const},
  {q: "site:xiaohongshu.com 保险 拒赔 真实经历", channel: "xiaohongshu" as const},
  {q: "site:xiaohongshu.com 香港保险 分红 实现率", channel: "xiaohongshu" as const},
];

function hostName(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "公开网页";
  }
}
function unwrapGoogleUrl(u: string) {
  try {
    const x = new URL(u);
    return x.searchParams.get("url") || u;
  } catch {
    return u;
  }
}

async function fetchWithTimeout(url: string, ms = 8000, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {...init, signal: ctrl.signal});
  } finally {
    clearTimeout(t);
  }
}

async function rssSearch(
  q: string,
  channel: RawHit["channel"]
): Promise<RawHit[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    q + " when:7d"
  )}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const r = await fetchWithTimeout(url, 10000, {
    cache: "no-store",
    headers: {"User-Agent": "Mozilla/5.0 TrendLab/1.0"},
  });
  if (!r.ok) throw new Error(`RSS ${r.status}`);
  const parsed = new XMLParser({ignoreAttributes: false}).parse(
    await r.text()
  );
  const items = parsed?.rss?.channel?.item || [];
  return (Array.isArray(items) ? items : [items])
    .slice(0, 10)
    .map((x: any) => {
      const link = unwrapGoogleUrl(String(x.link || ""));
      return {
        title: String(x.title || "").replace(/\s+-\s+[^-]+$/, ""),
        url: link,
        source: String(
          x.source?.["#text"] || x.source || hostName(link)
        ),
        publishedAt: String(x.pubDate || ""),
        snippet: String(x.description || "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 500),
        channel,
      };
    });
}

async function bingNewsSearch(q: string, channel: RawHit["channel"]): Promise<RawHit[]> {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`;
  const r = await fetchWithTimeout(url, 10000, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 TrendLab/1.0",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`Bing ${r.status}`);
  const parsed = new XMLParser({ignoreAttributes: false}).parse(
    await r.text()
  );
  const items = parsed?.rss?.channel?.item || [];
  return (Array.isArray(items) ? items : [items])
    .slice(0, 10)
    .map((x: any) => {
      const link = String(x.link || "");
      return {
        title: String(x.title || "").replace(/<[^>]*>/g, ""),
        url: link,
        source: String(x.source || hostName(link)),
        publishedAt: String(x.pubDate || ""),
        snippet: String(x.description || "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 500),
        channel,
      };
    });
}

async function tavilySearch(): Promise<RawHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const bodies = queries.map(async (x) => {
    const r = await fetchWithTimeout("https://api.tavily.com/search", 15000, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        api_key: key,
        query: x.q,
        topic: "news",
        days: 7,
        max_results: 10,
        search_depth: "advanced",
      }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || []).map((y: any) => ({
      title: y.title,
      url: y.url,
      source: hostName(y.url),
      publishedAt: y.published_date || "",
      snippet: y.content || "",
      channel: x.channel,
    }));
  });
  return (await Promise.all(bodies)).flat();
}

export async function collectHits(): Promise<{hits: RawHit[]; mode: string}> {
  let hits: RawHit[] = [];
  let mode = "ai-fallback";

  // 1. Tavily 增强搜索
  if (process.env.TAVILY_API_KEY) {
    try {
      hits = await tavilySearch();
      if (hits.length) mode = "enhanced";
    } catch {}
  }

  // 2. 浏览器抓取（仅在非 Vercel 环境执行）
  if (!hits.length && !process.env.VERCEL) {
    try {
      hits = await scrape360(browserScrapeJobs, {
        headless: process.env.BROWSER_HEADLESS !== "false",
        msEdgePath: process.env.MSEDGE_PATH,
      });
      if (hits.length) mode = "browser-scrape";
    } catch (e: any) {
      console.warn("[collectHits] browser scrape failed:", e?.message || e);
    }
  }

  // 3. 公开 RSS 兜底
  if (!hits.length) {
    const settled = await Promise.allSettled([
      ...queries.map((x) => rssSearch(x.q, x.channel)),
      ...queries.map((x) => bingNewsSearch(x.q, x.channel)),
    ]);
    hits = settled.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
    if (hits.length) mode = "public-rss";
  }

  const seen = new Set<string>();
  const deduped = hits
    .filter((x) => x.title && x.url && !seen.has(x.title) && (seen.add(x.title), true))
    .slice(0, 32);

  return {hits: deduped, mode};
}
