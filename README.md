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

按下面顺序做。Cloudflare 控制台用中文界面时，名称以你屏幕上看到的为准。

### 1. 准备 Telegram

1. 打开 [@BotFather](https://t.me/BotFather)，发送 `/newbot`，按提示创建，复制 **Token**。
2. 发送 `/mybots` → 选中这个 Bot → **Bot Settings** → **Group Privacy** → **Turn off**。
3. 新建一个群（只给你自己当收件箱用），把 Bot 拉进去。
4. 在群设置里打开 **话题 / Topics**。
5. 把 Bot 设为管理员，权限里勾选 **管理话题 / Manage Topics**。
6. 用 Telegram **桌面端**，在群里任意消息上右键 → **复制消息链接**。  
   链接中的 `-100xxxxxxxxxx` 就是 `SUPERGROUP_ID`。如果只有纯数字，前面自己补上 `-100`。

### 2. 部署 Worker

打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左侧 **Workers 和 Pages**。

**方法一：连接 GitHub（推荐）**

1. 点 **创建** → 连接到 Git，选择本仓库，部署。
2. 部署完成后点进 Worker `telegram-private-bot`。

**方法二：手动粘贴**

1. 点 **创建** → **创建 Worker**。
2. 点 **编辑代码**，用本仓库 `worker.js` 全部覆盖后，点右上角部署。

### 3. 创建并绑定 KV

KV 是一块小数据库，用来存「谁对应哪个话题」。**不要在 Worker 的「运行时变量和密钥」里找它。**

创建入口在 Cloudflare 控制台**最左侧栏**：

1. 点左侧 **存储和数据库**（点文字旁的小三角展开）。
2. 在展开列表里点 **Workers KV**（它在「Postgres 和 MySQL 数据库」下面、「D1 SQLite 数据库」上面）。
3. 点 **创建命名空间**，名字随意，例如 `TOPIC_MAP`。
4. 再回到 Worker 页面，顶部标签点 **设置**（和「概述、指标、部署」同一排）。
5. 向下找到 **绑定**（在「运行时变量和密钥」下面那一栏），点右侧 **添加绑定**。
6. 类型选 **KV 命名空间**。  
   **名称**填 `TOPIC_MAP`（必须全大写）。  
   **值 / 命名空间**选刚刚创建的那个。保存。

### 4. 填写运行时变量和密钥

仍在 Worker → **设置**。最上面一栏叫 **运行时变量和密钥**。

点右侧 **添加变量**，加两条：

| 名称 | 填什么 |
| :--- | :--- |
| `BOT_TOKEN` | 第 1 步 BotFather 给你的 Token |
| `SUPERGROUP_ID` | 第 1 步复制的群 ID，必须 `-100` 开头 |

保存。Cloudflare 通常会自动再部署一次，等状态变绿即可。

如果出现黄条「更新您的 Wrangler 配置……」：点黄条里的 **wrangler.toml**，把 `[[kv_namespaces]]` 下面那串 `id` 填进本仓库的 `wrangler.toml`，再推送到 GitHub。不要把 `BOT_TOKEN` 写进文件。

可选变量也加在这一栏，不配也能用：`TURNSTILE_SITEKEY`、`TURNSTILE_SECRET`、`PUBLIC_BASE_URL`、`SPAM_KEYWORDS`、`SPAM_SILENCE_MODE`、`WEBHOOK_SECRET`。

### 5. 设置 Webhook

1. Worker 顶部点 **概述** 或 **域**，复制地址，形如 `https://telegram-private-bot.xxx.workers.dev`。要带 `https://`，末尾不要 `/`。
2. 用浏览器打开（两处换成你的值）：

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<Worker地址>
```

3. 看到 `Webhook was set` 或 `Webhook is already set` 后，再打开：

```
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

确认返回里的 `url` 就是你的 Worker 地址。

如果配置了 `WEBHOOK_SECRET`，setWebhook 的链接末尾还要加 `&secret_token=同一个值`。

### 6. 检查是否成功

给 Bot 发 `/start`，应弹出人机验证。通过后再发一句普通文字，管理群里会出现该用户的话题；进这个话题打字即可回复对方。
