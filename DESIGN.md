# icons+ 设计文档 & 逻辑评审

> 基于 `xg-icons-hub` 扩展，新增：管理后台、用户提交审核、防盗链。
> 生成时间：2026-11-10

## 1. 项目定位
`icons+` = 可共建的图标托管平台。在保留原有图库浏览 / 外链能力的基础上，新增：
- 管理后台（默认 `admin` / `iconsplus`）
- 用户提交「网址 + 接口」→ 后台审核 → 通过后自动获取图标
- 防盗链（Referer 校验）

## 2. 关键约束：图片 + 文件夹映射逻辑保持不变
这是本次重构的红线，前端改版绝不能动：
- 物理存储：`images/<分类文件夹>/<文件名>`
- 对外 URL：`/images/<分类>/<文件名>`（复制链接 / 下载 / 新窗口 / 预览全部指向它）
- 分类 API：`/api/icons.json` = `[{ "name": 分类, "icons": [文件名...] }]`
- 缩略图：`/thumbs/<路径>.webp`（容器内生成，刻意与 `/images` 分离，不污染宿主机图标库）
- `getIcons()` 只读**顶层文件夹**为分类、其下文件为图标（不递归子目录）

## 3. 你的原始逻辑 & 优化建议（v1 已落地）
原意：用户提交「网址 + 接口」→ 后台审核 → 通过后获取图标 → 防盗链。
结论：方向正确，v1 补齐了以下容易被忽略的点：

1. **接口契约未定义** → 约定用户接口返回：
   ```json
   { "category": "可选单层名", "icons": [ { "name": "xx", "url": "https://…/x.png" }, "https://…/bare.png" ] }
   ```
   审核通过即按此拉取，落盘到 `images/user_<站点>/`（隔离，避免覆盖官方库）。
2. **服务端代用户拉取任意 URL = SSRF 风险** → 导入器：仅 http(s)；解析域名后逐个拒绝
   私有 / 回环 / 链路本地 / 保留地址；单文件 2MB、单次 100 张上限；15s 超时。
   开发期可用 `ALLOW_LOCAL_IMPORT=1` 放行本地地址自测。
3. **防盗链用 Referer（可被伪造）** → 默认：同站永远放行、空 Referer 可配、白名单按 host 后缀匹配；
   文档已提示生产可升级为签名 token / 时间戳校验。
4. **导入应异步 / 幂等 / 隔离** → 归入独立 `user_<站点>` 分类；逐条记录失败项，单条出错不中断。
5. **公开提交口需防刷 + 审计** → 每 IP 每小时限流（默认 20）；每次审核记录 `reviewedBy` / `reviewedAt`；后台可看详情。

## 4. 架构
```
浏览器
 ├─ /            图库（重构 UI，映射不变）
 ├─ /admin       管理后台（登录 / 审核队列 / 防盗链设置）
 ├─ /api/icons.json, /api/config.json      公开
 ├─ POST /api/submissions                   公开（限流）
 ├─ /api/admin/*                              需登录 cookie
 └─ /images/* , /thumbs/*                    静态资源 + 防盗链中间件
```
模块：`server/index.js`（路由）+ `server/services/{iconScanner,thumbnailer,htmlTemplate,auth,store,hotlink,importer}.js`
状态：`data/submissions.json`（提交）、`data/settings.json`（防盗链配置，后台可改）。

## 5. 鉴权
- 默认 `admin` / `iconsplus`，务必改 `ADMIN_PASSWORD`。
- 会话：`HMAC-SHA256` 签名 cookie `iconsplus_session`，7 天过期。
- `SESSION_SECRET` 未设置时启动告警（使用不安全默认值）。

## 6. 运行
开发：
```bash
npm install
cp .env.example .env   # 改 ADMIN_PASSWORD / SESSION_SECRET
npm start              # http://localhost:5000
```
Docker：
```bash
docker compose up -d --build   # 端口 28080 -> 5000，镜像名 iconsplus:dev
```

## 7. 下一步建议
- 把「提交接口契约」做成规范 + 示例源码，降低贡献门槛
- 防盗链升级为签名 token（Referer 可伪造，弱防护）
- 导入改为真正的异步任务队列 + 进度反馈
- 用户提交图标做内容安全审核（除类型/大小外的恶意文件）
- 多管理员 / 角色权限
