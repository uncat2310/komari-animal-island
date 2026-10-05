# 机机森友会 AnimalIsland — 1.0.8-local 更新日志

日期：2026-10-05（Asia/Shanghai） · 分支：`local/sec-1.5-adapt` · 基线：1.0.7-local
包：`AnimalIsland-1.0.8-local.zip`（`komari-theme.json` + `preview.png` + `dist/`）
范围：只改主题前端，未改动服务端。
依据：多份内部安全审计的共识清单（审计报告未公开）。

## 安全加固

1. **Logo 地址 `safeImageSrc`（src/security.ts）**
   - 新增 `isPublicHostname()`：拒绝 IPv4/IPv6 字面量（包括 `0x7f.1`、`2130706433`、`[::1]`、`[fe80::]`、`[::ffff:127.0.0.1]`）、`localhost`/`*.localhost`、单段主机名，以及 `*.local`、`*.internal`、`*.lan`、`*.home.arpa`、`*.corp`、`*.test` 等后缀和 `metadata.google.internal`，也拒绝 `nip.io`/`sslip.io` 这类会解析到内网的通配域名。RFC1918 和 169.254.0.0/16 都是 IP 字面量，所以一起被拒。
   - 只接受默认的 443 端口，自定义端口一律拒绝。
   - 黑名单补上 `weserv.nl` 及其所有子域（`sub.images.weserv.nl` 原本能绕过）。
   - 品牌 Logo `<img>` 加上 `referrerPolicy="no-referrer"` 和 `decoding="async"`。
2. **禁用 SVG Logo**：`data:image/svg+xml` 和远程 `.svg` 都拒绝，只允许位图（png/webp/jpeg/gif）。data URI 必须是严格的 base64 字符集，并保留 200 000 字符上限。
3. **备案链接 `safeFilingUrl`（新增）**：ICP/公安备案链接只允许 https，主机须为 `beian.miit.gov.cn`、`beian.mps.gov.cn`、`(www.)beian.gov.cn` 或其它 `*.gov.cn`。官方域名的旧 `http://` 配置会自动升级成 https；其它地址（任意站点、内网 IP、仿冒的 `beian.miit.gov.cn.evil.com`）**只显示备案号文字、不生成链接**。链接同时加上 `referrerPolicy="no-referrer"`。
4. **文本截断（`truncateText`，按码点截断，不会切断 emoji）**：`brand_title` 32 字、`brand_subtitle` 64 字、`footer_content` 200 字、备案号 64 字，超出部分以 `…` 结尾。
5. **`data_update_interval` 下限改为 3 秒**：App 里的取值范围改成 3–60 秒，theme.json 的帮助文案同步更新。实测把设置填成 1 时，实际按 3 秒刷新。
6. **Ping / 三网延迟轮询在标签页隐藏时暂停**：新增 `visibleInterval()`，切回前台时立刻补刷一次再恢复 20 秒周期。
7. **生产构建禁用 `?demo=1`**：`import.meta.env.PROD` 时 `isDemoRequested()`/`wantsDemo()` 恒为 false。`loadInitialData` 内联了这个 PROD 判断，mock 模块会被 tree-shake 掉（生产 bundle 里已没有 `demo-japan` 等假节点数据）。
8. **修复 demo 完整性 bug（Grok 部分报告指出）**：demo 模式下不再调用 `connectLive`。旧逻辑的问题是：实时数据只替换 `online/live`，`nodes` 里仍是 3 个假节点，顶栏却已经显示“实时连接”。另外删掉了回调里的 `setDemo(false)`。
9. **WS / HTTP 不再重复发送（Antigravity M-02）**：RPC2 WebSocket 处于 OPEN 状态、且最近 3 个周期内有过有效回包时，只走 WS，不再并发调用 `rpc2Http`。WS 停滞超过 3 个周期或断开后会自动退回 HTTP。成功过的 WS 断开后允许在下一周期重连，从未成功过的才标记为失败。WS 帧超过 4 MB 直接丢弃。

## 正确性（附带修复）

- **嵌套指标映射（Grok 部分报告指出）**：`mapRawStatus` 以前写的是 `value.cpu ?? asRecord(value.cpu)?.usage`，`cpu` 是对象时 `??` 永远走不到 `.usage`，结果显示 0%，给出“看起来很空闲”的假信号。现在改用 `metric(flat, nested, key)` 同时兼容扁平数字和嵌套对象两种写法（cpu/ram/swap/disk/network/load/connections）。Komari 1.5 实际下发的是扁平数字，所以生产环境基本触发不到，属于防御性修复。

## 审计报告新增的加固

- **严格在线判定（Grok M-02）**：只有 `online === true` 才算在线，且在线 id 只取状态字典的键，单条记录不能借 `client` 字段把另一台机器标成在线。仪表盘的在线数、平均 CPU、流量和速率只统计 `/api/nodes` 里存在的 uuid，状态字典里多出来的键不再计入。
- **`/api/nodes` 字段白名单（Grok L-02 / M-04）**：新增 `sanitizeNodes()`，只保留需要渲染的字段，丢弃 `token`、`ipv4`、`ipv6` 等。uuid 走 `sanitizeUuidKey` 并去重，最多 1000 个节点。各字段截断：name/os/cpu_name/gpu_name 128 字、region/group/virtualization 64 字、public_remark 1000 字、currency 16 字。
- **GPU 明细最多 16 条，`updated_at` 截到 64 字（Grok M-04 / L-04）**。
- **登录错误信息只渲染字符串，上限 200 字（Grok L-03）**。
- **package-lock.json 根版本号**从 1.0.6 改为 1.0.8-local（Grok I-04 锁文件卫生）。

## 依赖

10. **animal-island-ui 升级：本版暂不升级，继续锁定 1.6.0（残留风险已记录）**
    - 已试 1.14.0：构建失败，`Icon`、`Wallet` 导出被移除，`Time type="hud"`、`Footer type="sea"` 的类型变了，`animal-island-ui/items/*` 素材目录也没了。
    - 已查 1.9.0（作者建议的最低版本）：没有 `Loading`、`Time`、`Wallet`、items，`Icon` 只剩 10 个，缺少本主题用到的 `icon-helicopter`、`icon-miles`、`icon-critterpedia`。2.x 连 `Icon` 都去掉了。
    - 结论：升级要重做顶栏、加载页、钱包、统计卡片图标和页脚，视觉回归很大，按要求“不发布坏掉的 UI”。1.6.0 的 deprecated 理由是**版权素材**（“content removed for copyright reasons”），不是安全 CVE。`npm audit` 结果是 0 个漏洞。
    - 残留风险：上游不再维护，存在版权合规/下架风险。后续需要单独的 UI 迁移版本（替换图标/素材）。

## 版本号

11. `package.json` 和 `komari-theme.json` 的版本号改为 `1.0.8-local`，theme.json 的描述和各字段帮助文案也同步更新（Logo 只收位图且限公网域名、备案链接只收官方 https 地址、截断长度、3–60 秒）。

## 未改动 / 已知

- 后端（Komari）不会在保存时校验 `theme_settings`，主题只能在渲染时消毒（MiMo M2），需要服务端配合。
- 没有 CSP（index.html 和反代都没配），属纵深防御建议。
- 登录接口原样回显 `result.message`（Antigravity L-06）：React 会转义，按 Low 处理，本版未改。
- `node.name`、`public_remark` 等节点字段没有长度上限，数据来自管理员或 agent，按 Low/Info 处理。
