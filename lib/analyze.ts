import type {RawHit, Trend} from "./types";

const SYSTEM_PROMPT = "你是资深保险内容策划与事实核查编辑。严格输出可解析JSON，不要Markdown代码块。";

function buildCommonRules(): string {
  return `规则：
- 优先选择「讨论度高、容易引发争议或共鸣」的选题：理赔纠纷、法院诉讼、退保损失、销售误导、拒赔争议、带病投保、猝死免责、甲状腺/乳腺结节理赔、香港分红险实现率波动等；
- 政策监管与案例新闻并重，但案例/诉讼类应占半数以上；
- 禁止虚构具体的法院案号、判决金额、当事人姓名、保险公司内部数据；
- 涉及案件只描述「公开报道中常见的争议类型」，用概括性表述，避免造谣；
- 每条必须明确标注置信度，并说明原始来源类型（监管文件/公开报道/司法案例/AI参考）。`;
}

function fallback(h: RawHit, i: number): Trend {
  return {
    id: `fallback-${i}-${Date.now()}`,
    title: h.title,
    sourceType: h.channel,
    sourceName: h.source,
    sourceUrl: h.url,
    publishedAt: h.publishedAt || "待核实",
    collectedAt: new Date().toISOString(),
    confidence: h.channel === "authority" ? "高" : "中",
    event: h.title,
    summary: h.snippet || "公开页面提供的信息较少，建议打开原文核实完整语境。",
    insuranceBridge: "从事件对家庭风险、理赔权益、投保告知或销售合规的影响切入，避免强行蹭热点。",
    topics: ["事件对投保人有什么影响", "理赔/投保时应注意什么", "哪些结论不能过度解读"],
    contentIdeas: ["30秒热点解释", "一图看懂争议焦点", "客户问答口径"],
    goldenLines: ["热点可以追，结论不能抢。", "先看事实，再谈保障。"],
    visual: "新闻标题特写→关键事实卡片→争议焦点三点图示；使用低饱和商务配色。",
    voiceover: `今天关注一条消息：${h.title}。先别急着下结论，我们先看它涉及谁、争议点在哪里，再判断和保险购买或理赔有什么关系。具体信息请以原始来源为准。`,
    tags: ["保险热点", "专业解读"],
  };
}

function buildHitPrompt(hits: RawHit[]): string {
  const input = hits.map((h, i) => ({ index: i, ...h }));
  return `根据下方搜索结果，筛选10条最值得保险从业者创作的热点。讨论度优先；案例、诉讼、理赔纠纷、监管通报优先；抖音、小红书只能作为公开索引线索，不得把无法核实的热度或内容当作事实。

${buildCommonRules()}

只返回JSON数组，每项字段严格为：index(对应输入序号), title, event, summary, insuranceBridge, topics(3条), contentIdeas(3条，说明适合发什么), goldenLines(2条), visual, voiceover(80-160字), tags(2-4条), confidence(高/中/线索)。event说明发生了什么；summary给出热点梗概；insuranceBridge说明如何自然引到保险。

搜索结果：${JSON.stringify(input)}`;
}

function buildAIPrompt(): string {
  return `当前网络搜索不可用，请你作为资深保险内容策划，基于对中国保险市场公开讨论、理赔纠纷、监管通报、法院判决、社交平台热议的专业理解，生成10条「保险圈当前讨论度最高、最值得从业者创作」的内容灵感。

${buildCommonRules()}

选题方向（至少半数）：
1. 理赔纠纷/法院诉讼：重疾险、意外险、医疗险、寿险的拒赔争议；
2. 销售误导/退保损失：夸大收益、未如实告知、销售话术问题；
3. 监管/政策：预定利率下调、报行合一、养老险税优；
4. 港险/储蓄险：分红实现率、汇率风险、收益演示；
5. 投保告知：带病投保、乳腺/甲状腺结节、体检异常影响核保。

只返回JSON数组，每项字段严格为：title, event, summary, insuranceBridge, topics(3条), contentIdeas(3条), goldenLines(2条), visual, voiceover(80-160字), tags(2-4条), confidence(固定为"AI参考")。

额外说明：这些灵感是AI基于行业知识生成，供内容策划参考，发布前请结合最新官方信息核实。`;
}

async function callDeepSeek<T>(prompt: string): Promise<T> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("尚未配置 DEEPSEEK_API_KEY");
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.35,
      response_format: { type: "json_object" },
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 180)}`);
  }
  const data = await r.json();
  let text = String(data.choices?.[0]?.message?.content || "")
    .replace(/^```json|```$/g, "")
    .trim();
  return JSON.parse(text);
}

function normalizeArray(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  return parsed.items || parsed.trends || parsed.data || parsed.result || [];
}

export async function analyze(hits: RawHit[]): Promise<Trend[]> {
  if (!hits.length) {
    const parsed = await callDeepSeek<{ trends: any[] } | any[]>(buildAIPrompt());
    const arr = normalizeArray(parsed);
    if (!arr.length) throw new Error("AI 未能生成灵感，请检查 DeepSeek 配置");
    return arr.slice(0, 10).map((a: any, i: number) => ({
      id: `ai-${Date.now()}-${i}`,
      title: a.title || "AI 生成选题",
      sourceType: "ai",
      sourceName: "AI 灵感参考（需核实）",
      sourceUrl: "#",
      publishedAt: "待核实",
      collectedAt: new Date().toISOString(),
      confidence: "AI参考",
      event: a.event || a.title || "",
      summary: a.summary || "",
      insuranceBridge: a.insuranceBridge || "",
      topics: Array.isArray(a.topics) ? a.topics : [],
      contentIdeas: Array.isArray(a.contentIdeas) ? a.contentIdeas : [],
      goldenLines: Array.isArray(a.goldenLines) ? a.goldenLines : [],
      visual: a.visual || "",
      voiceover: a.voiceover || "",
      tags: Array.isArray(a.tags) ? a.tags : ["AI参考", "保险灵感"],
    }));
  }

  const parsed = await callDeepSeek<{ trends: any[] } | any[]>(buildHitPrompt(hits));
  const arr = normalizeArray(parsed);
  if (!arr.length) return hits.slice(0, 10).map(fallback);

  return arr.slice(0, 10).map((a: any, i: number) => {
    const h = hits[Number(a.index)] || hits[i];
    return {
      ...fallback(h, i),
      ...a,
      id: `${Date.now()}-${i}`,
      sourceType: h.channel,
      sourceName: h.source,
      sourceUrl: h.url,
      publishedAt: h.publishedAt || "待核实",
      collectedAt: new Date().toISOString(),
    };
  });
}
