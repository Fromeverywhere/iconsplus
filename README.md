# icons+

可共建的图标托管平台。在 [xg-icons-hub](https://github.com/verkyer/xg-icons-hub) 基础上扩展，新增**管理后台、角色权限、用户提交审核、防盗链**。

## 功能
- 🖼️ 分类图标图库（对外 URL 与 xg-icons-hub 完全一致：`/icons/<分类>/<文件>`）
- 🗂️ 分类显示名与文件夹名解耦：后台可改中文显示名、管理分类内图片；
  `/api/icons.json` 新增 `label` 字段（展示用），`name` 字段含义不变，旧调用方兼容。
  文件夹名即外链 URL 的一部分，<b>不提供重命名</b>（避免批量链接失效）
- 📖 后台内置「使用手册」页签（0.4.0），起步操作一目了然
- 🧑‍💻 自助注册 + 审批（0.5.0）：注册默认「仅调用」，超管审批后可用；用户改密码、
  维护个人防盗链白名单（泛域名 `*.*.a.com` / 域名 / IP，条数上限超管可调，默认 5）；
  访客预览仅可下载原图（图床外链仅登录用户可用）；搜索支持中文与模糊匹配；后台加「返回图库」按钮
- 🎨 现代化 UI（0.3.1，按 modern-web-guidance 最佳实践重构）：
  `color-scheme` + `light-dark()` 明暗主题（跟随系统、可手动切换、无 FOUC）、
  原生 `<dialog>` 模态（焦点圈定 / Esc / `::backdrop` 内建）、
  `@starting-style` 进出场动画、`prefers-reduced-motion` 适配、
  键盘可达（`focus-visible`、语义化按钮卡片）、http 环境剪贴板回退
- ⚡ 缩略图加速（sharp 自动生成，缺图回退原图，不污染图标库）
- 🔐 管理后台：默认 `admin` / `iconsplus`
- 👥 三档角色权限：**超级管理员** / **上传+调用** / **仅调用**（含用户管理、个人 API Token）
- 📥 用户上传图标：账号级<b>上传审批</b>（默认需要审核，超管可在「用户管理」逐账号改为直接进图库）；
  待审文件暂存 `data/pending-uploads/`，后台「看板 → 待审核图标」可预览、通过或拒绝
- 🛡️ 防盗链（Referer 白名单 / 黑名单双控，同站放行）
- 🚫 待审队列上限与单文件大小校验（防止刷盘）
- 📊 管理后台统计面板（全站图标/调用/白名单/待审核数据 + 个人数据）
- 🏷️ 图标译名（0.7.0）：卡片显示去扩展名的文件名 + 浅色译名小字（英文名给中文译名，中文名给英文译名）；
  存量图标首次启动自动补全，超管可批量改译名/批量删除，普通用户可改自己上传图标的译名
- 📈 Umami 网站统计（0.7.0）：后台填服务地址 + 网站 ID 即可在全部页面注入统计脚本，隐私友好、可自托管
- ⚖️ 页脚备案展示（0.7.0）：ICP 备案链接到工信部系统，公安网安备案链接到公安部查询系统，均带专用标识；
  页脚同时展示作者署名与开源项目致谢（`xg-icons-hub` 可点击到上游主页）
- 🌐 公网访问及调用域名（1.0.0）：后台配置 `PUBLIC_URL` 后，外链复制、后台 API 示例、
  外部调用失败的提示图统一使用该域名；留空回退当前访问地址
- 🖼️ 品牌化失败提示（1.0.0）：外部 `<img>` 请求 `/icons`、`/thumbs` 遇到 404/403 时返回
  一张 SVG（icons+ 标识 +「图片无法访问」+ 完整 URL），不再显示破图
- 🔗 按网址调用图标（1.2.0-1.2.2）：网页里放一条固定链接 `GET /api/icon?url=<网址>&token=<Token>`，
  按**一级域名**匹配图标（忽略路径），302 返回；五级回退（用户域名条目 → 服务器域名默认 →
  图库唯一匹配 → 用户兜底 → 官方兜底），检索不到时永远出官方兜底图。解析层 no-store、
  图片层吃 30 天 CDN 缓存。调用量按用户归属统计；识别不出时通过管理员/个人 Webhook 告警（含调用人和域名）。
  **token + 白名单双层生效**：已配置个人白名单的用户，调用页域名（Referer）必须命中自己的白名单；
  未配置白名单则不限制；未命中（含无 Referer）严格拒绝。放行后一律 302 到稳定签名直链（1.4.1+），
  图片可被 CDN 跨用户缓存。另提供 `mode=json` / `mode=diagnose`，返回签名直链与完整调用诊断，
  便于接入自检（详见「调用侧集成」）。
- 🔑 双 Token 分离（1.2.2）：**调用 Token**（仅读取，支持自定义，8-64 位字母/数字/_/-）与
  **上传 Token**（程序化上传专用，只可随机重置）相互独立，泄露互不影响；
  调用量统计按用户名归属，自定义 Token 不丢数据。
- 🚫 非法调用说明页（1.2.2）：无效 Token / 过期 / 来源未授权的 `/api/icon` 调用，以及白名单外的
  直链盗链，均返回品牌化 403 说明页 SVG（提示「如需调用请注册后添加白名单」），不再回 icons+ logo；
  logo 兜底仅用于「图标检索不到」的正常回退场景
- 🎯 图标域名匹配（1.3.0）：图标管理新增「域名匹配」列（至多 3 个一级域名，逗号分隔），
  API 按网址调用时**显式命中优先于文件名猜测**（同域名配多个图标会歧义失效）；
  附自动匹配脚本（`scripts/match_icon_domains.js`，锚点 + 人工策展映射，冲突与变体一律跳过）
- 🗂️ 「API 调用」独立分页（1.3.0）：调用/上传 Token、API 文档与「图标 API 设置」（兜底图 + 域名专属图标）
  全部集中在「API 调用」页，个人设置回归纯个人事务（头像 / 密码 / 推荐流）

## 角色与权限
| 能力 | 超级管理员 | 上传+调用 | 仅调用 |
|---|:---:|:---:|:---:|
| 浏览图库 / 调用图标 API | ✅ | ✅ | ✅ |
| 提交图标源（上传） | ✅ | ✅ | ❌ |
| 审核上传图标 / 待审队列 | ✅ | ❌ | ❌ |
| 防盗链设置 / 统计 | ✅ | ❌ | ❌ |
| 用户管理（建号 / 改角色 / 禁用 / 重置 Token） | ✅ | ❌ | ❌ |

- 首次启动自动种子一个**超级管理员**（`ADMIN_USERNAME` / `ADMIN_PASSWORD`，默认 `admin` / `iconsplus`）。
- 其余账号在后台「用户管理」创建。**API Token 有两个用途**：程序化上传图标（仅 super/uploader），
  以及 1.2.0 的「按网址调用图标」`/api/icon`（所有注册用户，含仅调用角色）。`/api/icons.json` 与图片直链本身公开可读。
- 所有登录用户都可以设置**自定义头像**（存 `data/profile_photo/profile_photo_<用户名>.<ext>`，独立于图床）；仅调用角色无上传图标权限。
- 数据库：`data/users.json`（已 gitignore，运行时生成）。

## 快速开始
```bash
npm install
cp .env.example .env      # 务必修改 ADMIN_PASSWORD 与 SESSION_SECRET
npm start                 # http://localhost:5000
```
图库：`http://localhost:5000/`　登录 / 后台：`http://localhost:5000/login`（旧 `/admin` 会 301 跳转到这里）

## 在线站点
| 站点 | 地址 | 说明 |
|---|---|---|
| 云端示范图库（主服务） | https://icons.325hub.top | 图库 / 控制台 / API，注册即可调用 |
| 宣传页（独立静态站） | https://iconsplus.325hub.top | 产品介绍与界面截图，源码在 [`promo/`](./promo) |

宣传页自 1.0.0 起**不再封装进容器**：主服务中旧的 `/ad` 路由会 301 跳转到宣传页域名；
宣传页为纯静态页面，单独部署（任意静态托管均可，云端部署在宝塔 + EdgeOne 加速）。

## 调用侧集成

第三方项目接入 icons+ 图标 API：一个 URL 输入框即可完成接入，附带真实取回图标的自检页与加载闪烁优化。
**图标来源切到 icons+ 时，调用方的「图标地址」字段应留空隐藏，并显示置灰提示「已由icons+提供图标」**——适配文件内置 `markProvided()` helper 一行落地，细节见文档。
完整用法见公开仓库的 [API 调用适配文档](https://github.com/Fromeverywhere/iconsplus/blob/main/integration/API%E8%B0%83%E7%94%A8%E9%80%82%E9%85%8D%E6%96%87%E6%A1%A3.md)。
零依赖适配文件在 [`integration/iconsplus-adapter.js`](./integration/iconsplus-adapter.js)，复制到调用方项目即可使用。

## Docker
```bash
docker compose up -d --build
```

## EdgeOne 边缘加速（可选，公网部署）
公网域名走腾讯云 EdgeOne 时，推荐两项边缘配置（详见 [deploy/edgeone/README.md](./deploy/edgeone/README.md)）：

- **强制 HTTPS**：在 EdgeOne 域名配置开启，否则 `http://` 不跳转（源站 nginx 的 301 会被边缘截获回源绕过）。
- **边缘防盗链**：图片被边缘缓存后应用层 Referer 校验会被绕过，需部署 `deploy/edgeone/anti-hotlink.js` 边缘函数，
  对 `/icons/*`、`/thumbs/*` 在边缘校验 Referer，盗链返回品牌 SVG（403）。个人版支持，含 300 万请求/月额度。

## 用户接口契约（提交审核用）
你的「图标接口」需返回 JSON：
```json
{
  "category": "可选单层名",
  "icons": [
    { "name": "myicon", "url": "https://example.com/i.png" },
    "https://example.com/other.png"
  ]
}
```
审核通过后，图标被下载到 `icons/user_<站点>/`，并即时出现在图库。

## 站点设置（后台 → 站点设置）
- **Umami 网站统计**：Umami 是开源、隐私友好的网站访问统计工具（可自托管，也可用官方云 `cloud.umami.is`），
  用来统计访问量、来源、热门页面等，**不收集个人敏感信息**。在 Umami 添加网站拿到 Website ID 后，
  在后台填「服务地址」（如 `https://cloud.umami.is`，不要带 `/script.js`）和「网站 ID」并保存即可生效；
  两项留空任一即关闭。对应环境变量为 `UMAMI_URL` / `UMAMI_SITE_ID`（后台未配置时的兜底）。
- **备案信息**：ICP 备案号填在「ICP 备案」，公安网安备案号填在「公安网安备案」。
  页脚会分别链接到工信部备案系统与公安部备案查询系统，并带专用备案图标；纯展示，不影响功能。
- 其它可配项：防盗链白/黑名单、普通用户白名单条数上限、调用有效期默认天数、管理员通知 Webhook、致谢/备案（站点名称、logo、版权与作者已固定不可改）。

## 环境变量
见 `.env.example`：`ADMIN_USERNAME/PASSWORD`（首次种子超级管理员）、`SESSION_SECRET`、
`HOTLINK_ENABLED` / `HOTLINK_ALLOWLIST`（白名单）/ `HOTLINK_DENYLIST`（黑名单）/ `HOTLINK_ALLOW_EMPTY_REFERER`、
`THUMB_*`、`UMAMI_URL` / `UMAMI_SITE_ID`（统计，可被后台设置覆盖）、
`PUBLIC_URL`（公网访问及调用域名，如 `https://icons.example.com`）、
`API_ICON_SIGN_SECRET`（1.2.0 按网址调用图标的稳定签名密钥；需与 EdgeOne 边缘函数 `SIGN_SECRET` 一致，见 `deploy/edgeone/`）、
`ICP` / `GONGAN`（页脚备案初始值）、`CREDITS` / `CREDITS_URL`（开源致谢及跳转地址）。站点名称、logo、版权与作者已固定，不提供环境变量或后台修改入口。

## 目录
```
server/         Express 服务 + 各 service 模块（users 含角色/Token）
views/          index.html（图库） / admin.html（后台）
static/         前端样式与脚本
promo/          宣传页（独立静态站，部署到 iconsplus.325hub.top，不进容器）
icons/         图标库（icons/<分类>/<文件>）
data/           运行期数据（提交、设置、用户），已 gitignore
```

详见 [DESIGN.md](./DESIGN.md)。
