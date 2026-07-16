"use client";
import {useEffect, useState} from "react";
import type {Trend} from "../lib/types";

const channels = [
  ["all", "全部"],
  ["hot", "诉讼/案例"],
  ["authority", "权威机构"],
  ["news", "保险新闻"],
  ["douyin", "抖音线索"],
  ["xiaohongshu", "小红书线索"],
  ["ai", "AI灵感"],
];

const modeLabel: Record<string, string> = {
  enhanced: "Tavily 增强搜索",
  "public-rss": "公开新闻 RSS",
  "browser-scrape": "浏览器全网抓取（360 + 小红书/抖音 site 搜索）",
  "ai-fallback": "AI 灵感模式（网络搜索受限）",
};

const caseKeywords = /诉讼|纠纷|拒赔|理赔|判决|法院|退保|误导|案例|争议|免责|结节|癌/;

function isHotCase(x: Trend): boolean {
  return (
    caseKeywords.test(x.title) ||
    x.tags.some((t) => caseKeywords.test(t)) ||
    caseKeywords.test(x.summary)
  );
}

export default function Page() {
  const [items, setItems] = useState<Trend[]>([]);
  const [active, setActive] = useState<Trend | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState("");

  useEffect(() => {
    const old = localStorage.getItem("trend-cache");
    if (old) {
      try {
        setItems(JSON.parse(old));
      } catch {}
    }
  }, []);

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/trends", {method: "POST"});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "刷新失败");
      setItems(j.trends);
      setMode(j.meta?.searchMode || "");
      localStorage.setItem("trend-cache", JSON.stringify(j.trends));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const list =
    filter === "all"
      ? items
      : filter === "hot"
      ? items.filter(isHotCase)
      : items.filter((x) => x.sourceType === filter);

  return (
    <main className="shell">
      <header>
        <div className="brand">
          <div className="logo">险</div>
          <div>
            <small>AI INSURANCE TREND LAB</small>
            <h1>险业热点灵感台</h1>
          </div>
        </div>
        <button className="refresh" onClick={refresh} disabled={loading}>
          {loading ? (
            <>
              <i />
              正在采集与分析…
            </>
          ) : (
            "↻ 刷新全网热点"
          )}
        </button>
      </header>

      <section className="hero">
        <div>
          <span className="badge">案例优先 · 来源可追溯 · AI策划</span>
          <h2>
            热点很多，
            <br />
            值得讲的才留下。
          </h2>
          <p>
            聚焦理赔纠纷、法院诉讼、监管通报等高讨论度选题，自动整理成可直接发布的保险内容方案。
          </p>
        </div>
        <div className="status">
          <b>{items.length || "—"}</b>
          <span>今日灵感</span>
          <hr />
          <small>
            {items[0]
              ? `最近采集 ${new Date(items[0].collectedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "点击刷新开始首次采集"}
          </small>
        </div>
      </section>

      {mode && <div className="mode">当前模式：{modeLabel[mode] || mode}</div>}

      <nav>
        {channels.map((x) => (
          <button
            key={x[0]}
            className={filter === x[0] ? "on" : ""}
            onClick={() => setFilter(x[0])}
          >
            {x[1]}
          </button>
        ))}
      </nav>

      {err && (
        <div className="error">
          <b>暂时没有刷新成功</b>
          <span>{err}</span>
          <small>请检查服务器环境变量或稍后重试，现有缓存不会丢失。</small>
        </div>
      )}

      {!items.length && !loading ? (
        <section className="welcome">
          <span>✦</span>
          <h3>采集今天第一批内容灵感</h3>
          <p>首次使用请确认服务器已配置 DeepSeek API 密钥，然后点击右上角刷新。</p>
          <button onClick={refresh}>开始采集</button>
        </section>
      ) : (
        <section className="grid">
          {list.map((x) => (
            <article key={x.id} onClick={() => setActive(x)}>
              <div className="source">
                <span className={`dot ${x.sourceType}`} />
                {x.sourceName}
                <em>{x.confidence}</em>
              </div>
              <h3>{x.title}</h3>
              <p>{x.summary}</p>
              <div className="tags">
                {x.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
              <footer>
                <span>
                  {x.publishedAt === "待核实"
                    ? "时间待核实"
                    : new Date(x.publishedAt).toLocaleDateString("zh-CN")}
                </span>
                <b>查看策划 →</b>
              </footer>
            </article>
          ))}
        </section>
      )}

      <p className="notice">
        说明：
        {mode === "browser-scrape"
          ? "当前为浏览器抓取模式，通过 360 搜索及 site: 过滤抓取公开网页信息，每条卡片点击后可查看原始来源链接。"
          : mode === "ai-fallback"
          ? "当前为 AI 灵感模式，灵感由 DeepSeek 基于行业知识生成，案例和诉讼类选题已做加重，发布前请结合最新官方信息核实。"
          : "社交平台内容仅采集可被公开搜索引擎索引的线索，不代表平台官方热度排名；政策、收益及保险条款以官方原文和合同为准。"}
      </p>

      {active && (
        <div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setActive(null)}
        >
          <aside>
            <button className="close" onClick={() => setActive(null)}>
              ×
            </button>
            <div className="detailSource">
              <span className={`sourceBadge ${active.sourceType}`}>
                {active.sourceType === "ai" ? "AI 生成参考" : active.sourceName}
              </span>
              {active.sourceUrl && active.sourceUrl !== "#" ? (
                <a href={active.sourceUrl} target="_blank">
                  查看原始来源 ↗
                </a>
              ) : (
                <span className="aiTip">AI 生成，发布前请结合官方信息核实</span>
              )}
            </div>
            <h2>{active.title}</h2>
            <div className="section">
              <label>事件</label>
              <p>{active.event}</p>
            </div>
            <div className="section">
              <label>热点梗概</label>
              <p>{active.summary}</p>
            </div>
            <div className="section accent">
              <label>如何抓住热点</label>
              <p>{active.insuranceBridge}</p>
              <ul>{active.topics.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="section">
              <label>可以发布的内容</label>
              <ul>{active.contentIdeas.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="section quotes">
              <label>文案与金句</label>
              {active.goldenLines.map((x) => (
                <blockquote key={x}>“{x}”</blockquote>
              ))}
            </div>
            <div className="section">
              <label>画面设计</label>
              <p>{active.visual}</p>
            </div>
            <div className="section script">
              <label>参考口播</label>
              <p>{active.voiceover}</p>
              <button onClick={() => navigator.clipboard.writeText(active.voiceover)}>
                复制口播
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
