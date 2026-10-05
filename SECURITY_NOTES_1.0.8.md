# AnimalIsland 1.0.8-local — 安全说明（审计项关闭情况）

基线 1.0.7-local → 1.0.8-local · 2026-10-05（Asia/Shanghai） · 仅在本地测试环境验证。
对照四份内部审计报告（未公开），编号前缀：**G**、**A**、**Mi**、**R**。

## 已关闭

| 问题 | 来源编号 | 1.0.8 处理 |
|---|---|---|
| 生产包响应 `?demo=1`；连上真实接口后，假节点挂着“实时连接” | G H-01 · A L-05 · Mi L4 · R R5 | PROD 构建 `wantsDemo()` 恒为 false，mock 模块被 tree-shake 掉；demo 模式不再调用 `connectLive` |
| Logo 可指向私网、环回、元数据、IPv6 本地地址 | G M-01 · A M-01 · Mi M1 · R R2 | 新增 `isPublicHostname()`：拒绝 IP 字面量、localhost、`*.local`/`*.internal` 等后缀、单段名、nip.io 类通配域名和非 443 端口；`<img referrerPolicy="no-referrer">` |
| `data:image/svg+xml` 和远程 .svg | G M-01 · A L-01 · Mi L1 · R R4 | 只收位图；data URI 要求严格 base64 字符集 |
| 图片代理黑名单可绕过（如 `sub.images.weserv.nl`） | G M-01 · Mi L3 · R R3 | `weserv.nl` 全部子域都拒；结合“只收公网域名”。仍不是白名单，见残留 |
| 备案链接可指向任意 http(s) 主机 | G L-01 · A M-03 · Mi M3 | `safeFilingUrl()`：只允许 https 的 `*.gov.cn` 官方备案主机，其余只显示文字；官方域名的 http 自动升级为 https |
| 标题/页脚长度无上限，标题按字符拆成大量 DOM | G M-04 · A L-04 · R R8 | 标题 32、副标题 64、页脚 200、备案号 64（按码点截断） |
| 刷新间隔下限 1 秒 | G M-03 · A L-03 · R R6 | 下限改为 3 秒（App 和 theme.json 都改了） |
| 后台标签页仍在轮询 Ping | G M-03 · A L-02 · R R6 | `visibleInterval()`：隐藏时暂停，可见时补刷一次 |
| WS 与 HTTP 重复发送 | G M-03 · A M-02 | WS 健康（OPEN 且 3 个周期内有回包）时跳过 HTTP；停滞或断开后回落 HTTP |
| 超大 WS 帧 | G M-03 | 超过 4 MB 的帧直接丢弃 |
| 嵌套状态显示成 0 占用；`online` 按真值判断；`client` 可冒用其它 uuid；汇总不和节点求交 | G M-02 | `metric()` 兼容扁平/嵌套写法；`online === true`；在线 id 只取字典键；汇总前与 `/api/nodes` 求交 |
| `/api/nodes` 整对象进 state，uuid 不限长 | G L-02 | `sanitizeNodes()` 字段白名单并截断，uuid 走 `sanitizeUuidKey` |
| GPU 明细数组不限长 | G M-04 | 最多 16 条 |
| 登录 message 若非字符串会让子树崩溃 | G L-03 · (A L-06 部分) | 只渲染字符串，最多 200 字 |
| 锁文件根版本与 package.json 不一致 | G I-04 | 根版本改为 1.0.8-local |

## 残留 / 推迟（含原因）

| 问题 | 来源 | 状态 |
|---|---|---|
| `animal-island-ui@1.6.0` 已被作者标 deprecated（版权原因） | Mi M4 | **推迟**。1.9.0、1.14.0、2.x 去掉了 Icon/Wallet/Loading/Time/items 等本主题依赖的组件和素材，1.14.0 直接构建失败。要做单独的 UI 迁移版本。这不是安全 CVE，`npm audit` 结果为 0 |
| 服务端不校验 `theme_settings`，只在渲染时消毒 | Mi M2 · R R1 | 需要 Komari 服务端配合，主题侧做不到 |
| 外部 Logo 仍允许任意**公网** https 图床（可当追踪像素，但已 no-referrer） | G M-01 · Mi L2 | 按设计保留管理员自定义能力；如需更严，可改为固定 CDN 白名单 |
| 依赖 DNS 的内网访问（公网域名解析到私网 IP、DNS rebinding） | A M-01 延伸 | 浏览器侧无法校验解析结果，属已知限制 |
| 列表 `key` 含 `updated_at`，每轮采样重挂卡片 | G L-04 | 推迟（只是性能问题；为避免视觉回归不改，`updated_at` 已截到 64 字） |
| Ping 任务接口失败时仍按节点扇出 | G M-03 子项 | 保留：为兼容旧版 Komari 没有公开任务端点的情况。已有上限 64 节点、并发 4，隐藏时暂停 |
| 无 CSP / frame-ancestors | G L-05 · A I-01 · R I1 | 应由 Komari 或反代加响应头 |
| 登录、API 错误文案原样回显（已转义） | A L-06 · R R7 | 只做了字符串校验和截断，没有改成错误字典 |
| 锁文件里有 extraneous `../animal-island-ui-main`，部分条目缺 integrity | G I-04 | 推迟（重新生成锁文件可能改变依赖解析） |
| 登录 CSRF / Cookie SameSite | G L-03 · Mi L6 | 属于服务端 |

## 本地验证（Komari 1.5.1 本地测试实例）

- `safeImageSrc` / `safeFilingUrl` / `truncateText`：49 个单元用例全部通过（IP 的十六进制/十进制写法、IPv6、`.local`、nip.io、svg、端口、凭据、仿冒的 gov.cn 等）。
- 浏览器（headless Chrome）：页面加载无报错；内网 Logo 被拒；ICP 指向 evil 时只显示文字；公安链接 http 自动升级为 https；标题和页脚被截断；间隔填 1 时实际按约 3 秒走 WS。
- WS 健康后不再发 HTTP：前 16–23 秒内只有 1–2 次 `POST /api/rpc2`（首次加载时），之后全走 WS 帧。
- 标签页隐藏约 29 秒期间：服务端日志里 `/api/rpc2` 请求为 0；可见后立即补刷。
- PROD 包加 `?demo=1`：显示真实节点和“实时连接”（demo 已禁用）；dev 包加 `?demo=1`：一直是“演示数据”，没有任何 RPC/WS 请求（完整性 bug 已修复）。
- 登录：`/admin` 302 → `/admin/dashboard` 200，浏览器里的登录流程最终落在 Komari 管理端（`Komari Monitor`）。
