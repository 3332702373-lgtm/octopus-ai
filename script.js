/**
 * Vercel Serverless Function
 * 路径：/api/script
 * 作用：把前端的「一句话创意」转成结构化剧本 + 分镜 JSON
 * 密钥只从这里读取环境变量，前端永远拿不到
 */

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
  // 去掉 ```json 包裹
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "只接受 POST" });
    return;
  }

  const key = process.env.LLM_API_KEY;
  const base = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "deepseek-chat";

  const body = req.body || {};
  if (body.ping) {
    res.status(200).json({ ok: true, configured: !!key, model });
    return;
  }

  if (!key) {
    res.status(501).json({ error: "服务端未配置 LLM_API_KEY" });
    return;
  }

  const idea = String(body.idea || "").slice(0, 2000);
  if (!idea) {
    res.status(400).json({ error: "缺少创意内容" });
    return;
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

  try {
    const upstream = await fetch(base + "/chat/completions", {
      method: "POST",
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

    const raw = await upstream.text();

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: "上游模型返回错误",
        detail: raw.slice(0, 500),
      });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      res.status(502).json({ error: "上游返回非 JSON", detail: raw.slice(0, 300) });
      return;
    }

    const content =
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      "";

    const parsed = extractJSON(content);
    if (!parsed) {
      res.status(200).json({ error: "模型输出无法解析为 JSON", raw: content.slice(0, 1200) });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "请求失败：" + String(e).slice(0, 200) });
  }
};
