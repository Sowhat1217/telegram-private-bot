// 冒烟测试：内容过滤、指令解析、Turnstile 开关
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const src = fs
  .readFileSync(__dirname + "/worker.js", "utf8")
  .replace("export default", "module.__fetch_handler =");

const sandbox = {
  console,
  module: { exports: {} },
  crypto: require("crypto").webcrypto,
  TextEncoder,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  FormData,
  fetch: async () => {
    throw new Error("no network in test");
  },
  Map,
  Uint8Array,
  Uint32Array,
  URL,
  Request: typeof Request !== "undefined" ? Request : undefined,
  Response: typeof Response !== "undefined" ? Response : undefined,
};
vm.createContext(sandbox);
vm.runInContext(
  src +
    "\nmodule.exports = { analyzeContentSignals, filterMessage, CONFIG, isTurnstileEnabled, parseCommand, escapeHtml, parseWordList, fetchHandler: module.__fetch_handler };",
  sandbox,
  { filename: "worker.js" },
);

const {
  analyzeContentSignals,
  filterMessage,
  CONFIG,
  isTurnstileEnabled,
  parseCommand,
  escapeHtml,
  parseWordList,
  fetchHandler,
} = sandbox.module.exports;

function expectAction(name, msg, action, extraKeywords) {
  const s = analyzeContentSignals(msg, extraKeywords || []);
  const fScore = s.score;
  let got;
  if (fScore >= CONFIG.FILTER_BLOCK_SCORE) got = "block";
  else if (fScore >= CONFIG.FILTER_GRAY_SCORE) got = "flag";
  else got = "pass";
  assert.strictEqual(
    got,
    action,
    `${name}: expected ${action} got ${got} (score=${s.score}, reasons=${s.reasons.join(",")})`,
  );
  return s;
}

(async () => {
  console.log(
    "阈值: block>=" +
      CONFIG.FILTER_BLOCK_SCORE +
      ", gray>=" +
      CONFIG.FILTER_GRAY_SCORE,
    "\n",
  );

  const cases = [
    ["纯正常消息", { text: "你好，我想咨询一下你们的售后流程" }, "pass"],
    [
      "正常带链接",
      { text: "你好，这个问题我之前在 https://example.com/a 看到过说明" },
      "flag",
    ],
    [
      "刷单广告",
      { text: "宝妈兼职刷单返利，动动手指日入300，详聊" },
      "block",
    ],
    ["赌博引流", { text: "澳门威尼斯人博彩开户存送，秒到账 t.me/xxx88" }, "block"],
    ["t.me 引流", { text: "想看更多资源，进群 t.me/spam_group" }, "flag"],
    ["留手机号", { text: "有事打我电话 13812345678" }, "flag"],
    ["表情刷屏", { text: "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉 优惠大促" }, "flag"],
    ["空消息", { text: "" }, "pass"],
    ["图片无说明", {}, "pass"],
    ["不含微信规则", { text: "请加微信 abc12345 详聊" }, "pass"],
  ];

  for (const [name, msg, action] of cases) {
    const s = expectAction(name, msg, action);
    const f = await filterMessage(msg, {});
    assert.strictEqual(f.action, action, `${name}: filterMessage mismatch`);
    console.log(`[${name}] 评分=${s.score}  判定=${f.action}`);
    if (s.reasons.length) console.log("   特征:", s.reasons.join("、"));
  }

  // 同一条 URL 不应被正则 + 实体重复加到 block
  const oneLink = analyzeContentSignals({
    text: "文档在 https://example.com/a",
    entities: [{ type: "url", offset: 4, length: 19 }],
  });
  assert.ok(
    oneLink.score < CONFIG.FILTER_BLOCK_SCORE,
    `单链接不应直接拦截, score=${oneLink.score}`,
  );
  console.log(`[单链接不重复计分] 评分=${oneLink.score} 判定=flag/pass`);

  // 动态屏蔽词
  const custom = analyzeContentSignals(
    { text: "请看一下内部代号水煮鱼套餐" },
    ["水煮鱼套餐"],
  );
  assert.ok(custom.score >= CONFIG.FILTER_BLOCK_SCORE, "自定义词应拦截");
  console.log(`[自定义屏蔽词] 评分=${custom.score} 判定=block`);

  const envFilter = await filterMessage(
    { text: "请看一下内部代号水煮鱼套餐" },
    { SPAM_KEYWORDS: "水煮鱼套餐,另一个词" },
  );
  assert.strictEqual(envFilter.action, "block");
  console.log("[SPAM_KEYWORDS] 判定=block");

  // 指令解析
  const helpCmd = parseCommand("/help");
  assert.strictEqual(helpCmd.cmd, "help");
  assert.strictEqual(helpCmd.arg, "");
  const helpAt = parseCommand("/help@MyBot");
  assert.strictEqual(helpAt.cmd, "help");
  assert.strictEqual(helpAt.arg, "");
  const addCmd = parseCommand("/addword 内部暗号");
  assert.strictEqual(addCmd.cmd, "addword");
  assert.strictEqual(addCmd.arg, "内部暗号");
  const startCmd = parseCommand("/start@demo_bot extra");
  assert.strictEqual(startCmd.cmd, "start");
  assert.strictEqual(startCmd.arg, "extra");
  const noneCmd = parseCommand("hello");
  assert.strictEqual(noneCmd.cmd, "");
  console.log("[parseCommand] OK");

  assert.strictEqual(escapeHtml("<uid>"), "&lt;uid&gt;");
  assert.strictEqual(parseWordList("a, b；c").join("|"), "a|b|c");
  console.log("[escapeHtml/parseWordList] OK");

  assert.strictEqual(isTurnstileEnabled({}), false);
  assert.strictEqual(
    isTurnstileEnabled({ TURNSTILE_SITEKEY: "s", TURNSTILE_SECRET: "k" }),
    true,
  );
  console.log("Turnstile 开关(空env):", isTurnstileEnabled({}));

  assert.ok(CONFIG.VERIFIED_EXPIRE_SECONDS === 2592000, "应保留 30 天验证有效期");
  if (fetchHandler && typeof Request !== "undefined") {
    const health = await fetchHandler.fetch(
      new Request("https://example.workers.dev/health"),
      {},
      {},
    );
    assert.strictEqual(await health.text(), "OK");
    console.log("[GET /health] OK");

    const missing = await fetchHandler.fetch(
      new Request("https://example.workers.dev/webhook"),
      { TOPIC_MAP: {} },
      {},
    );
    assert.ok((await missing.text()).includes("BOT_TOKEN"));
    console.log("[missing BOT_TOKEN] OK");

    const noTurnstile = await fetchHandler.fetch(
      new Request("https://example.workers.dev/verify?t=abc"),
      { TOPIC_MAP: { get: async () => null }, BOT_TOKEN: "x", SUPERGROUP_ID: "-1001" },
      {},
    );
    assert.strictEqual(noTurnstile.status, 404);
    console.log("[GET /verify without Turnstile] 404 OK");
  }

  const kv = {
    store: {},
    async get(key, opt) {
      const raw = this.store[key];
      if (raw == null) return null;
      if (opt && opt.type === "json") {
        try {
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }
      return raw;
    },
    async put(key, value) {
      this.store[key] = value;
    },
    async delete(key) {
      delete this.store[key];
    },
  };
  await kv.put("blocked_words_kv", JSON.stringify(["内部暗号"]));
  const kvFilter = await filterMessage(
    { text: "请回复内部暗号即可", from: { id: 1 }, chat: { id: 1 } },
    { TOPIC_MAP: kv },
  );
  assert.strictEqual(kvFilter.action, "block");
  console.log("[KV 动态屏蔽词] 判定=block");

  const repeatEnv = { TOPIC_MAP: kv };
  const repeatMsg = { text: "同一句话请看一下", from: { id: 99 }, chat: { id: 99 } };
  const r1 = await filterMessage(repeatMsg, repeatEnv);
  const r2 = await filterMessage(repeatMsg, repeatEnv);
  const r3 = await filterMessage(repeatMsg, repeatEnv);
  assert.ok(r3.score >= r1.score, "重复消息应加分");
  assert.ok(r3.reasons.some((x) => String(x).includes("重复消息")));
  console.log(`[重复消息] 第1次=${r1.score} 第2次=${r2.score} 第3次=${r3.score} ${r3.action}`);

  console.log("\n全部断言通过");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
