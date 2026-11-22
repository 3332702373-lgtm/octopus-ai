/**
 * Vercel Edge Function
 * 路径：/api/script
 * 作用：把前端的「一句话创意」转成结构化剧本 + 分镜 JSON
 * 密钥只从这里读取环境变量，前端永远拿不到
 */

export const config = {
  runtime: "edge",
};

const ALLOW_ORIGIN = "https://3332702373-lgtm.github.io";

const SYS_PROMPT = `你是专业3D国漫CG短剧编剧。请严格输出一个 JSON 对象，不要任何多余文字、不要 markdown 代码块。

JSON 结构必须为：
{
  "title": "剧集名称，带书名号",
  "world": "世界观简介，60字以内",
  "characters": [
    {
      "name": "角色名",
      "role": "主角/女主/反派/引路者",
      "look": "外貌与服饰描述，必须写清楚发型、眉形、服装材质与配色，方便后续3D国漫CG出图",
      "persona": "性格关键词，3-4个"
    }
  ],
  "shots": [
    {
      "no": 1,
      "lens": "远景/中景/近景/特写/广角",
      "duration": "6s",
      "move": "稳定跟拍/缓慢推镜/环绕/俯拍/拉镜",
      "desc": "画面描述，具体写人物动作、环境、光影，可直接用于CG出图，不要写台词",
      "line": "该镜台词或旁白，没有就留空字符串"
    }
  ]
}

要求：
1. shots 数量 5 到 8 条，节奏要有起伏。
2. desc 必须包含3D国漫CG画面感：材质、光位、景别、情绪。
3. 所有内容使用中文。
4. 只输出 JSON。`;

function extractJSON(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  const body = t.slice(first, last + 1);
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

function corsHeaders() {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  h.set("Cache-Control", "no-store");
  return h;
}

function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign(corsHeaders(), headers || {}),
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json(405, { error: "只接受 POST" });
  }

  const key = process.env.LLM_API_KEY;
  const base = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "deepseek-chat";

  let body = {};
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: "请求体不是合法 JSON" });
  }

  if (body.ping) {
    return json(200, { ok: true, configured: !!key, model });
  }

  if (!key) {
    return json(501, { error: "服务端未配置 LLM_API_KEY" });
  }

  const idea = String(body.idea || "").slice(0, 2000);
  if (!idea) {
    return json(400, { error: "缺少创意内容" });
  }

  const userPrompt = [
    `创意：${idea}`,
    `题材：${body.theme || "仙侠玄幻"}`,
    `风格：${body.style || "清冷仙侠"}`,
    `集数：${body.eps || "单集短片"}`,
    `故事背景：${body.bg || ""}`,
    `核心主题：${body.core || ""}`,
    `视觉参考：${body.ref || "3D国漫写实CG，冷色月光，体积光"}`,
  ].join("\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  try {
    const upstream = await fetch(base + "/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model,
        temperature: 0.75,
        messages: [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeoutId);

    const raw = await upstream.text();

    if (!upstream.ok) {
      return json(upstream.status, {
        error: "上游模型返回错误",
        detail: raw.slice(0, 500),
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return json(502, { error: "上游返回非 JSON", detail: raw.slice(0, 300) });
    }

    const content =
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      "";

    const parsed = extractJSON(content);
    if (!parsed) {
      return json(200, { error: "模型输出无法解析为 JSON", raw: content.slice(0, 1200) });
    }

    return json(200, parsed);
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      return json(504, { error: "请求超时，模型响应太慢，请重试" });
    }
    return json(500, { error: "请求失败：" + String(e).slice(0, 200) });
  }
}
