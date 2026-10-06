# 机机森友会 AnimalIsland — 1.0.10-local 更新日志

日期：2026-10-06 · 基线：1.0.9-local

## 恢复品牌 Logo（同源内置）

- 上游 1.0.6 的默认 Logo 是 `https://wsrv.nl/?url=https%3A%2F%2Fi.mij.rip%2F2026%2F08%2F18%2F3b1499d288d87344ca7a7a0de8c1434d.png`。1.0.8 起图片代理被拦截、1.0.9 默认值留空，所以未保存过主题设置的站点只显示直升机图标。
- 现在把原图（i.mij.rip 原始 PNG，389×389）缩放为 256×256 PNG（约 72 KB）放进 `src/assets/brand-logo.png`，构建后输出到 `dist/assets/brand-logo-<hash>.png`，通过 `import.meta.url` 相对解析，与警徽图片同一机制，不依赖 Komari 的主题挂载路径，也不再请求任何第三方域名。
- `security.ts` 新增 `safeBundledImageSrc()`（只接受同源 http(s) 位图路径或位图 data URI，拒绝跨域、SVG、`//`、`javascript:` 等）、`DEFAULT_BRAND_LOGO` 和 `brandLogoSrc()`。`safeImageSrc()` 对管理员输入的检查保持不变（仍拒绝 SVG、内网/IP、代理域名、http 等）。
- 管理员设置的 Logo 通过检查时优先显示；留空或被拒绝时显示内置 Logo（以前是直升机图标）。
- 版本号改为 `1.0.10-local`；`komari-theme.json` 中 Logo 字段说明同步更新。

## 验证

- `npm ci`、`npm run build`（含 `tsc -b`）通过。
- 过滤器用例：空值 / SVG / `data:image/svg+xml` / 内网 IP / `*.local` / localhost / wsrv.nl / i.mij.rip / images.weserv.nl / http / `javascript:` → 内置 Logo；公网 https PNG 与 PNG data URI → 管理员 Logo；跨域地址、SVG、协议相对地址不能通过同源检查。
