# icons+

可共建的图标托管平台。在 [xg-icons-hub](https://github.com/verkyer/xg-icons-hub) 基础上扩展，新增**管理后台、角色权限、用户提交审核、防盗链**。

## 功能
- 🖼️ 分类图标图库（对外 URL 与 xg-icons-hub 完全一致：`/images/<分类>/<文件>`）
- 🗂️ 分类显示名与文件夹名解耦（0.4.0）：后台可改中文显示名、重命名文件夹、管理分类内图片；
  `/api/icons.json` 新增 `label` 字段（展示用），`name` 字段含义不变，旧调用方兼容
- 📖 后台内置「使用手册」页签（0.4.0），起步操作一目了然
- 🎨 现代化 UI（0.3.1，按 modern-web-guidance 最佳实践重构）：
  `color-scheme` + `light-dark()` 明暗主题（跟随系统、可手动切换、无 FOUC）、
  原生 `<dialog>` 模态（焦点圈定 / Esc / `::backdrop` 内建）、
  `@starting-style` 进出场动画、`prefers-reduced-motion` 适配、
  键盘可达（`focus-visible`、语义化按钮卡片）、http 环境剪贴板回退
- ⚡ 缩略图加速（sharp 自动生成，缺图回退原图，不污染图标库）
- 🔐 管理后台：默认 `admin` / `iconsplus`
- 👥 三档角色权限：**超级管理员** / **上传+调用** / **仅调用**（含用户管理、个人 API Token）
- 📥 用户提交「网址 + 接口」→ 审核通过后自动收录图标（SSRF 防护）
- 🛡️ 防盗链（Referer 白名单 / 黑名单双控，同站放行）
- 🔄 异步导入（审核即返回，后台拉取图标，状态实时可见）
- 🚫 提交去重（同一站点 / 接口不重复进审核）
- 📊 管理后台统计面板（累计 / 待审 / 已收录 / 导入数 / 分类数）

## 角色与权限
| 能力 | 超级管理员 | 上传+调用 | 仅调用 |
|---|:---:|:---:|:---:|
| 浏览图库 / 调用图标 API | ✅ | ✅ | ✅ |
| 提交图标源（上传） | ✅ | ✅ | ❌ |
| 审核 / 拒绝 / 删除提交 | ✅ | ❌ | ❌ |
| 防盗链设置 / 统计 | ✅ | ❌ | ❌ |
| 用户管理（建号 / 改角色 / 禁用 / 重置 Token） | ✅ | ❌ | ❌ |

- 首次启动自动种子一个**超级管理员**（`ADMIN_USERNAME` / `ADMIN_PASSWORD`，默认 `admin` / `iconsplus`）。
- 其余账号在后台「用户管理」创建；每个账号带一个 **API Token**，可用于程序化「上传 / 调用」。
- 数据库：`data/users.json`（已 gitignore，运行时生成）。

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
见 `.env.example`：`SITE_NAME`、`ADMIN_USERNAME/PASSWORD`（首次种子超级管理员）、`SESSION_SECRET`、
`HOTLINK_ENABLED` / `HOTLINK_ALLOWLIST`（白名单）/ `HOTLINK_DENYLIST`（黑名单）/ `HOTLINK_ALLOW_EMPTY_REFERER`、
`SUBMISSION_RATE_LIMIT`、`THUMB_*`。

> 审核通过后图标在**后台异步**下载（不阻塞页面），可在管理后台实时查看导入进度与结果。

## 目录
```
server/         Express 服务 + 各 service 模块（users 含角色/Token）
views/          index.html（图库） / admin.html（后台）
static/         前端样式与脚本
images/         图标库（images/<分类>/<文件>）
data/           运行期数据（提交、设置、用户），已 gitignore
```

详见 [DESIGN.md](./DESIGN.md)。
