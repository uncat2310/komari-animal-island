# 机机森友会 AnimalIsland — 1.0.9-local 更新日志

日期：2026-10-05 · 基线：1.0.8-local · 对照 Komari 主线（1.5.x / 1.6.0-pre1）

## Komari 1.5+ 数据适配

1. **GPU 不再对所有节点显示 “GPU 0%”**：`common:getNodesLatestStatus` 总会返回 `gpu: 0`，真实 GPU 信息在顶层 `gpu_count` / `gpu_average_usage` / `gpu_detailed_info`。`parseGpu` 改为读取这些字段（兼容旧版 `/api/clients` 的嵌套 `gpu` 对象），只有确实上报 GPU 时才显示；多卡显示 `GPU ×N`，数值按百分比而不是字节显示。
2. **延迟直接使用实时数据**：1.5+ 的 `ping` 是 `{ 任务ID: { name, latest, avg, loss, … } }`（1 小时窗口）。旧逻辑只接受数字，导致全部丢弃，再每 20 秒对最多 64 个节点逐个请求 `getPingRecords`。现在 `parsePing` 解析对象格式（兼容旧版纯数字），单线路延迟和三网延迟（按任务名匹配）都直接取自实时帧；只有服务端没有在实时帧里下发延迟时，才回退到逐节点请求，而且会等第一帧到达后再判断。全部丢包的任务显示为 “—”。
3. **`public:getPingRecords` 的 `hours` 参数改为字符串**：服务端字段是 `string`，传数字会被忽略，实际按默认的 4 小时查询（数据量是预期的 4 倍）。
4. **TCP / UDP 数字修正**：RPC2 的 `connections` 是 TCP + UDP 总数，现在 TCP 按 `connections - connections_udp` 计算；旧版 `/api/clients` 的 `{ tcp, udp }` 不受影响。
5. **私有站点**：`/api/public` 返回 `private_site: true` 且节点接口被拒绝时，显示“岛民登录”引导，不再显示“API 离线”，也不再启动实时轮询。`/api/public` 单独失败时不再让整页进入离线状态。

## 安全 / 仓库卫生

- `index.html` 加上 `object-src 'none'; base-uri 'self'; form-action 'self'` 的 CSP 和 referrer 策略。没有限制 `script-src` / `img-src`，因为 Komari 会把管理员的自定义 head/body 注入到主题首页，限制过严会破坏这部分功能。
- `redirectToAdmin()` 改为直接跳转 `/admin`：Komari 对 `/admin*` 始终返回内置后台，不需要先发请求探测。
- `package-lock.json` 删除了多余的本地路径 `../animal-island-ui-main`。
- 删除了只能在作者本机运行的 `scripts/diagnose-runtime.mjs`；1.0.8 文档里的服务器主机名、内网地址和内部审计文件名都已去除。

## 验证

- `npm run build`（含 `tsc -b`）通过，`npm audit` 显示 0 个漏洞。
- 用 Komari 1.5 实际格式的数据测试 `mapRawStatus`：无 GPU 节点 → 不显示 GPU；GPU 节点 → 用量 55.5、2 张卡；全丢包任务 → `avg: null`；旧版嵌套格式和纯数字 ping 都能正确解析。
- 浏览器 + 模拟服务端：三网延迟由实时帧渲染，没有任何 `getPingRecords` / `getPublicPingTasks` 请求；3 秒间隔下 10 秒内 4 次状态轮询；私有站点显示登录引导，没有发出状态轮询。
