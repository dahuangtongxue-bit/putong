# 扑通 · AI 外星人伙伴

一个超拟人、高情感、有记忆的 AI 伙伴。扑通是从「静默星」掉到你窗台上的小外星人：它会记住你的事、到日子主动追问、有自己的情绪和小日子，和你越熟，胸口的「心核」越亮，也会一点点讲出它自己的故事。

## 它能做什么

| 模块 | 说明 |
|---|---|
| 灵魂 | 原创角色设定（来历、性格、说话方式、禁忌）+ 固定的安全边界；人设可在「实验室 → 灵魂设定」里直接改 |
| 内心独白 | 每一轮先写 `<inner>`：判断 TA 的情绪和真正的需要、自己的感受、要不要用某条记忆、这一轮用什么策略 |
| 情绪与身体 | `<feel>` 输出心情、愉悦度、激动度和动作指令；形象随心情变色、换表情，心核心跳随激动度变快，动作指令驱动身体动画 |
| 分层记忆 | 关于你的事实 / 发生过的事 / 挂念的事 / 你们之间的梗 / 扑通自己的设定；按相关度 × 重要度 × 新近度召回 |
| 主动性 | 开场不等模型：按时间、离开多久、到期的挂念组合问候；每天一道「今日地球问题」，随关系加深由浅入深 |
| 成长与剧情 | 羁绊值推动心核 5 个等级，每升一级解锁一章扑通的秘密，由它自己找时机讲出来 |
| 地球观察日记 | 把一天的聊天写成一页扑通视角的日记 |
| 评测台 | 12 个场景（初见、委屈、记忆召回、主动追问、危机信号、恋爱请求……），规则检查 + 模型评委 6 维打分，可对比人设版本 |
| 体验指标 | 回忆勾连率、提问率、挂念解开率、TA 每句字数变化、情绪曲线、策略分布 |
| 演示工具 | 时间机器（快进几天看隔天问候和追问）、羁绊调试、心声开关、朗读 |

## 目录

```
public/index.html                 发布的页面（由 build.py 生成）
src/                              页面源码：markup.html / style.css / content.js（人设、剧情、评测集）/ app.js（Agent 运行时）
build.py                          python3 build.py → 重新生成 public/index.html
netlify/edge-functions/chat.js    POST /api/chat，转发到 OpenAI 兼容接口，流式透传
netlify/edge-functions/health.js  GET /api/health，前端据此判断服务端模型是否可用
netlify.toml
```

## 部署到 Netlify

1. 把仓库推到 GitHub。
2. Netlify → Add new site → Import an existing project → 选这个仓库。发布目录会从 `netlify.toml` 读到 `public`，不需要构建命令。
3. 在 Site configuration → Environment variables 里加：

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 是 | 模型网关的 Key |
| `LLM_API_BASE` | 否 | 默认 `https://api-model.gpulink.cc/v1`（零克云 OpenAI 兼容网关） |
| `LLM_MODEL` | 否 | 默认 `deepseek-v4-flash-0731`，建议用不带思考的快模型 |
| `LLM_MODEL_FALLBACK` | 否 | 主模型 5xx / 限流 / 无可用渠道时自动切换的备用模型 |
| `ACCESS_CODE` | 否 | 设了之后访客要先在「实验室 → 设置」里填访问码，防止链接外传后被刷 |

4. 部署后打开 `/api/health`，看到 `"ok":true` 就接通了。

## 改人设或代码

改 `src/` 下的文件，然后 `python3 build.py`，把 `public/index.html` 一起提交。人设文字在 `src/content.js` 的 `DEFAULT_SOUL`；边界、记忆规则、输出格式是固定的，前端靠输出格式解析。

## 在 claude.ai 里运行

`build.py` 同时会生成 `dist/artifact.html`。发布成 claude.ai artifact 时声明 `sample`、`db`、`user` 三个能力：对话用打开者自己的 Claude 额度，记忆存在打开者自己的私有空间里。

## 数据

服务端不存任何对话。部署在 Netlify 时，记忆存在访客自己浏览器的 localStorage；在 claude.ai 里运行时，存在访客自己的私有云端空间，别人（包括发布者）看不到。
