# icons+ 调用侧适配文件

给第三方项目接入 icons+ 图标 API 用的适配层。复制 `iconsplus-adapter.js` 到调用方项目即可，**零依赖**。

## 它解决什么

不适配：业务代码里到处是长链接

```html
<img src="https://icons.325hub.top/api/icon?url=doubao.com&token=8c6e19575577341452a9ae53ccac5b8465a9">
```

适配后：配置和 token 只在一个地方，业务只写网址（完整 URL 或域名都行）

```js
IconPlus.icon('https://www.bilibili.com/video/BV1xx')  // 自动取 bilibili.com
// → https://icons.325hub.top/api/icon?url=bilibili.com&token=8c6e...
IconPlus.icon('bilibili.com')                          // 等价
```

## 三步接入

### 第 1 步：调用方后台加「icons+ 适配栏」

在调用方自己的管理后台 / 控制台加一个配置表单，让管理员填写：

| 字段 | 说明 | 示例 |
|---|---|---|
| 地址 | icons+ 服务地址，**填一个 URL 即可**（可带 `/api/icon` 路径，适配层自动拆分） | `https://icons.325hub.top` |
| 调用 token | icons+ 后台生成的**调用 Token**（只读权限） | `8c6e1957...` |
| 优先格式 format（可选） | 优先返回该格式图标，找不到自动回退 | `svg` |

这些存调用方自己的数据库 / 配置文件里（**不要写死在前端源码**）。

### 第 2 步：把配置注入前端

三种方式任选其一：

**方式 A：SSR 注入（推荐，token 不落静态文件）**

```html
<script>window.ICONSPLUS_CONFIG = {
  base: "https://icons.325hub.top",
  token: "<从后台配置读取>"
};</script>
<script src="/js/iconsplus-adapter.js"></script>
<script>IconPlus.configureFromGlobal();</script>
```

**方式 B：meta 标签**

```html
<meta name="iconsplus-config" content='{"base":"https://icons.325hub.top","token":"8c6e..."}'>
<script src="/js/iconsplus-adapter.js"></script>
<script>IconPlus.configureFromMeta();</script>
```

**方式 C：前端先 fetch 自己的配置接口**

```js
fetch('/api/my/iconsplus-config').then(r => r.json()).then(cfg => {
  IconPlus.configure(cfg);
});
```

### 第 3 步：业务代码只写网址

原生 HTML（配合 `applyTo` 批量填充）：

```html
<img data-icon-domain="https://www.bilibili.com/video/BV1xx" alt="哔哩哔哩">
<img data-icon-domain="netflix.com" alt="Netflix">
<script>IconPlus.applyTo();</script>
```

Vue：

```js
import IconPlus from './iconsplus-adapter.js';
IconPlus.configure(window.ICONSPLUS_CONFIG);
// 组件里
<img :src="IconPlus.icon(domain)" />
```

React：

```jsx
import IconPlus from './iconsplus-adapter.js';
IconPlus.configure(window.ICONSPLUS_CONFIG);
function SiteIcon({ url }) {
  return <img src={IconPlus.icon(url)} alt={url} />;
}
```

## 图标来源切到 icons+ 时：图标地址字段留空、置灰提示

很多调用方的表单里本来有一个「图标地址 / 图标 URL」输入框，让用户手填一个图片链接。接入 icons+ 后建议加一个**图标来源**选择（如「自定义地址 / icons+ 提供」）。当用户选择 **icons+** 时：

- **图标地址字段直接留空、不显示**（不要让用户填，也不要把 icons+ 的 API 链接塞进去——那个由适配层拼）
- 在原位置显示一条**置灰、不可编辑**的提示：**已由icons+提供图标**
- 图标来源重新切回「自定义地址」时，恢复原来的输入框和值

适配文件内置了 helper，一行即可落地：

```js
// 表单里有个 <input id="siteIconUrl">，来源切到 icons+ 时：
var restore = IconPlus.markProvided('#siteIconUrl', {
  hint: '已由icons+提供图标'   // 可省略，默认就是这个文案
});
// 切回「自定义地址」时还原：
restore();
```

`markProvided(field, opts)`：
| 参数 | 说明 |
|---|---|
| `field` | 图标地址输入框节点或 CSS 选择器 |
| `opts.hint` | 提示词，默认 `已由icons+提供图标` |
| `opts.container` | 提示插入的父节点，默认输入框的父节点 |
| `opts.hintClass` | 提示元素 class，默认 `iconsplus-provided-hint` |
| 返回值 | `restore()` 函数，调用后恢复输入框显示与原值 |

配套的两条 class 可自行写样式（适配文件不强制注入 CSS，`hintClass` 和 `inputClass` 都可改）：

```css
.iconsplus-provided-hint { color: var(--muted, #999); font-size: .9em; font-style: italic; }
.iconsplus-provided-input { display: none; }
```

若只改文案不改状态，用 `IconPlus.setProvidedHint('新文案')`；提示词常量为 `IconPlus.PROVIDED_HINT`。

> 该 helper 只做**视觉隐藏**，不清空输入框的值——切回自定义来源时原值还在。真正提交时由调用方根据自己的「图标来源」决定写不写地址字段：来源为 icons+ 就把地址字段置空入库，展示侧统一用 `IconPlus.icon(网址)` / `applyTo()` 出图。

## 消除「空白跳一下到图标」的闪烁

**为什么原来会闪**：老版 `<img src="/api/icon?...">` 走两跳——第一跳到解析层（每次回源、`no-store`，期间图片是空白），第二跳才到真正的图片。有本地缓存的直链图片只有一跳，所以不会闪。

**怎么办**：图标签名直链是稳定的（`?sig=` 不含时间戳），可以安全缓存。适配层在首次访问时拉一次直链写进浏览器 localStorage，之后 `<img>` 直接用直链，一跳命中 CDN 缓存。

- `applyTo()` 已内置：缓存命中直接填直链；未命中先显示灰色占位圆，异步预热后平滑淡入（不会空白跳动）。
- 首屏图标多时，可提前预热：

```js
IconPlus.warm(['bilibili.com', 'netflix.com', 'doubao.com']);
```

- 在 icons+ 后台改了某域名的默认图标后，本地缓存可能还是旧图，清一下即可：

```js
IconPlus.clearCache('bilibili.com');  // 只清一个域名
IconPlus.clearCache();                // 清空全部
```

缓存默认 6 小时（可在配置里改 `cacheTtl`）；关闭缓存设 `cacheEnabled: false`。

## 接入自检：填 token 真实取回图标 + 诊断

`selftest.html` 是一个可直接用的自检页，把本目录的 `iconsplus-adapter.js` 和 `selftest.html` **一起放到调用方网站域名下**访问即可。

它做三件事：

1. 一个输入框填网址或域名，自动提取一级域名、拼接 API、点一下真实取回图标
2. 显示本次调用的完整诊断：Token 归属的用户名、Token 是否有效/过期、调用页来源域名、访问 icons+ 用的是域名还是 IP、客户端 IP、白名单是否命中
3. 明确告诉你哪里设置不对、以及**该把哪个域名或 IP 加入白名单**，并可一键复制

> ⚠️ 自检页必须放在你的网站域名下（`https://` 访问）才能正确验证白名单。用 `file://` 本地打开时浏览器不带 Referer，诊断会判为「无来源」——这是浏览器机制，不是 bug。

诊断能力也开放给程序调用：

```js
IconPlus.diagnose('bilibili.com', function (diag) {
  console.log(diag.token.username);      // 这个 token 属于哪个 icons+ 用户
  console.log(diag.request.refererHost); // 调用页来源域名
  console.log(diag.request.iconsplusVia);// 'domain' 或 'ip'
  console.log(diag.whitelist.hit);       // 白名单是否命中
  console.log(diag.advice.addToWhitelist);// 建议加入白名单的域名/IP（为空表示无需添加）
  console.log(diag.issues);              // 问题清单，每项 { code, message, fix }
});
```

服务端对应 `GET /api/icon?url=...&token=...&mode=diagnose`，返回同样的 JSON（403 时也返回 JSON，带 `issues` 和 `advice`）。诊断与真实调用走同一套校验/解析逻辑，所见即所得。

## API

| 方法 | 说明 |
|---|---|
| `configure(opts)` | 注入/更新配置，支持增量合并；base 带路径会自动拆出 apiPath |
| `configureFromMeta()` | 从 `<meta name="iconsplus-config">` 读配置 |
| `configureFromGlobal(name?)` | 从 `window.ICONSPLUS_CONFIG` 读配置 |
| `icon(urlOrDomain)` | 网址/域名 → 完整调用 URL（自动取一级域名；命中缓存时返回签名直链） |
| `img(urlOrDomain, attrs)` | 生成带占位的 `<img>` 标签字符串 |
| `applyTo(selector?)` | 批量填充 `[data-icon-domain]` 的 src，自动预热直链 |
| `extractDomain(url)` | 从完整网址提取一级域名（eTLD+1） |
| `resolveAsync(url, cb, force?)` | 异步取签名直链并缓存；`force=true` 强制刷新 |
| `warm(domains, cb?)` | 批量预热域名直链 |
| `diagnose(url, cb)` | 真实调用一次并返回完整诊断 JSON |
| `markProvided(field, opts?)` | 图标来源切到 icons+：地址字段留空隐藏 + 置灰提示「已由icons+提供图标」，返回 restore() |
| `setProvidedHint(text?, container?)` | 只更新置灰提示词；`PROVIDED_HINT` 为默认文案常量 |
| `clearCache(domain?)` | 清缓存；不传域名则清空 |
| `status()` | 当前配置快照（token 脱敏），后台自检用 |
| `ready()` | 配置是否完整 |

## 前置动作：白名单

icons+ 1.2.1+ 是**严格模式**：调用方页面的域名必须加进 icons+ 账号的个人白名单，否则返回 403 说明页。

- 白名单在 icons+ 后台「个人设置 → 我的防盗链白名单」添加，填调用方**页面的顶级域名**（如 `myapp.com`，自动覆盖子域名）；也支持泛域名和公网 IP
- 浏览器 `<img>` 会自动带 Referer，无需额外配置
- 不确定该填什么？打开自检页看 `advice.addToWhitelist`，它直接告诉你该加哪条
- 服务端脚本 / 无 Referer 场景：白名单按来源域名校验，纯服务端调用建议用签名直链或联系管理员

## 关于 token 可见性

token 最终会出现在浏览器渲染出的 `<img src>` URL 里——这是 `<img>` 只能带 query 参数的机制决定的，任何前端拼接方案都一样。但：

- 调用 Token 是**只读**权限，无法上传/删除/改配置
- 叠加了**白名单双锁**：即使 token 泄露，也只有白名单内域名能调用
- 真要彻底隐藏 token，只能走 nginx 短路由（每个调用方服务器配一次 302），但那不适合静态托管

对绝大多数场景，前端拼接 + 白名单已经足够。

## 兼容性

- ES5 语法，无 Promise / 箭头函数 / 模块化依赖，老浏览器可用
- UMD 包装：浏览器全局 `IconPlus` / CommonJS `require()` / ESM `import` 均支持
- 签名与 CDN：icons+ 1.4.1 起白名单命中也走签名直链，图片可被 EdgeOne 缓存，调用方无需关心
