# Telegram Private bot

**V1.0.0**

跑在 Cloudflare Workers 上的 Telegram 双向私聊机器人。陌生人发来的私信会先过人机验证，再按本地规则过滤垃圾内容，通过后转发到管理员话题群，管理员在对应话题里直接回复即可。

## 核心特性

- **话题隔离**：每位用户对应管理员群里的一个 Forum Topic
- **人机验证**：可选用 Cloudflare Turnstile；未配置时回退本地常识题，验证有效期 30 天
- **内容过滤**：关键词 / 正则 / 动态词库打分。高危拦截，灰区照常转发并提醒，累计 3 次自动封禁
- **双向转发**：文本、图片、视频、文件
- **管理指令**：`/help` `/close` `/open` `/ban` `/unban` `/trust` `/reset` `/info` `/cleanup` `/addword` `/delword` `/listwords`  
  用户私聊里的 `/` 指令会被拦截，只在管理员群生效

## 部署

### 准备

1. 用 [@BotFather](https://t.me/BotFather) 创建 Bot，拿到 Token。关闭 **Group Privacy**。
2. 建一个开启 **Topics** 的群，把 Bot 拉进去并设为管理员（需要 Manage Topics）。
3. 群 ID 必须以 `-100` 开头。桌面端复制消息链接，链接里的 `-100xxxxxxxxxx` 就是 `SUPERGROUP_ID`；若只有纯数字，前面补上 `-100`。

### 必需配置

| 名称 | 说明 |
| :--- | :--- |
| KV 绑定 `TOPIC_MAP` | 存储话题映射、验证状态 |
| `BOT_TOKEN` | Bot Token |
| `SUPERGROUP_ID` | 管理员群 ID（`-100` 开头） |

可选：`TURNSTILE_SITEKEY` / `TURNSTILE_SECRET`（人机验证）、`PUBLIC_BASE_URL`（自定义域名）、`SPAM_KEYWORDS`（额外屏蔽词，逗号分隔）、`SPAM_SILENCE_MODE=true`（拦截时不通知管理员）、`WEBHOOK_SECRET`（校验 webhook）。

Git 连接部署时，在 `wrangler.toml` 取消注释 `[[kv_namespaces]]`，填入你自己的 KV Namespace ID，并保留 `keep_vars = true`。

### 方法一：Git 连接（推荐）

1. Fork 本仓库。
2. Cloudflare Dashboard → **Workers & Pages** → **Create Application** → **Connect to Git**，选择该仓库并部署。
3. 进入 Worker **Settings**，绑定 KV `TOPIC_MAP`，添加 `BOT_TOKEN`、`SUPERGROUP_ID`。
4. 打开 **Deployments**，对最新记录点 **Retry deployment**，让变量生效。

### 方法二：手动粘贴

1. Cloudflare → **Workers & Pages** → **Create Worker**。
2. **Edit code**，用本仓库 `worker.js` 覆盖后 Deploy。
3. **Settings → Variables**：绑定 `TOPIC_MAP`，添加 `BOT_TOKEN`、`SUPERGROUP_ID`，保存并部署。

### 激活 Webhook

浏览器访问：

```
https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
```

若设置了 `WEBHOOK_SECRET`，在 URL 末尾加上 `&secret_token=<WEBHOOK_SECRET>`。

返回 `{"ok":true,"result":true,"description":"Webhook was set"}` 即部署成功。

使用 Turnstile 时，还需要：在 Cloudflare Turnstile 添加 Worker 域名，并把同一域名登记到 BotFather 的 Mini App Domain。验证消息里同时提供浏览器备用链接。
