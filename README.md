# icons+

图标托管 / 图床服务。

**源码已转为私有仓库维护，不再开源。**

- Docker 镜像：`fromeverywhere/iconsplus`（版本标签 `1.2.0`，latest 同步更新）
- 私有源码仓库：`Fromeverywhere/iconsplus-src`（不对外公开）
- 使用文档与后台内嵌「使用手册」：部署后访问 `/admin` 查看

## 调用侧集成

第三方项目接入 icons+ 图标 API：一个 URL 输入框即可完成接入，附带真实取回图标的自检页与加载闪烁优化。

- [API 调用适配文档](./integration/API%E8%B0%83%E7%94%A8%E9%80%82%E9%85%8D%E6%96%87%E6%A1%A3.md) — 完整接入教程与自检说明
- [`iconsplus-adapter.js`](./integration/iconsplus-adapter.js) — 零依赖适配文件，复制到调用方项目即可使用
- [`selftest.html`](./integration/selftest.html) — 放到调用方域名下，填 token 真实取回图标并诊断配置

如需部署或使用，请直接使用 DockerHub 镜像；本仓库仅作对外说明与发布入口。
