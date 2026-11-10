# icons+

可共建的图标托管平台。在 [xg-icons-hub](https://github.com/verkyer/xg-icons-hub) 基础上扩展，新增**管理后台、用户提交审核、防盗链**。

## 功能
- 🖼️ 分类图标图库（重构 UI，但对外 URL 与 xg-icons-hub 完全一致：`/images/<分类>/<文件>`）
- ⚡ 缩略图加速（sharp 自动生成，缺图回退原图，不污染图标库）
- 🔐 管理后台：默认 `admin` / `iconsplus`
- 📥 用户提交「网址 + 接口」→ 审核通过后自动收录图标（SSRF 防护）
- 🛡️ 防盗链（Referer 白名单 / 黑名单双控，同站放行）
- 🔄 异步导入（审核即返回，后台拉取图标，状态实时可见）
- 🚫 提交去重（同一站点 / 接口不重复进审核）
- 📊 管理后台统计面板（累计 / 待审 / 已收录 / 导入数 / 分类数）

## 快速开始
```bash
npm install
cp .env.example .env      # 务必修改 ADMIN_PASSWORD 与 SESSION_SECRET
npm start                 # http://localhost:5000
```
图库：`http://localhost:5000/`　管理后台：`http://localhost:5000/admin`

## Docker
```bash
docker compose up -d --build
```

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
审核通过后，图标被下载到 `images/user_<站点>/`，并即时出现在图库。

## 环境变量
见 `.env.example`：`SITE_NAME`、`ADMIN_USERNAME/PASSWORD`、`SESSION_SECRET`、
`HOTLINK_ENABLED` / `HOTLINK_ALLOWLIST`（白名单）/ `HOTLINK_DENYLIST`（黑名单）/ `HOTLINK_ALLOW_EMPTY_REFERER`、
`SUBMISSION_RATE_LIMIT`、`THUMB_*`。

> 审核通过后图标在**后台异步**下载（不阻塞页面），可在管理后台实时查看导入进度与结果。

## 目录
```
server/         Express 服务 + 各 service 模块
views/          index.html（图库） / admin.html（后台）
static/         前端样式与脚本
images/         图标库（images/<分类>/<文件>）
data/           运行期数据（提交、设置），已 gitignore
```

详见 [DESIGN.md](./DESIGN.md)。
