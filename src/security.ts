/** URL / media allowlists for admin-controlled theme settings. */

const MAX_DATA_IMAGE_CHARS = 200_000; // ~150KB binary after base64

const BLOCKED_SCHEMES = /^(javascript|data|vbscript|file|blob):/i;

/**
 * Allow only absolute http(s) URLs for filing / external links.
 * Rejects javascript:, data:, protocol-relative, and path-escape tricks.
 */
export function safeHttpUrl(raw: string | undefined | null, fallback = ''): string {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  if (BLOCKED_SCHEMES.test(value) || value.startsWith('//')) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    if (url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

// Raster only. SVG (remote or data:) is rejected for the brand logo (1.0.8).
const IMAGE_EXT = /\.(png|webp|jpe?g|gif)(?:$|[?#])/i;
const DATA_IMAGE = /^data:image\/(png|webp|jpeg|jpg|gif);base64,[A-Za-z0-9+/=\s]+$/i;

const BLOCKED_IMAGE_HOSTS = [
  'wsrv.nl', 'images.weserv.nl', 'weserv.nl', 'mij.rip',
];

/** True when host is an IPv4 literal (incl. legacy short / hex / octal forms normalised by URL). */
function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Reject hosts the visitor's browser should never be pointed at by an
 * admin-controlled <img>: IP literals (v4/v6), localhost, mDNS / internal
 * suffixes, single-label intranet names, and metadata endpoints.
 * Public DNS names only.
 */
export function isPublicHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  // IPv6 literal (URL.hostname keeps brackets) — covers ::1, fe80::, fc00::, ::ffff:127.0.0.1
  if (host.startsWith('[') || host.includes(':')) return false;
  // Any IPv4 literal (WHATWG URL already normalises 0x7f.1, 2130706433, 0177.0.0.1 → dotted quad)
  if (isIpv4Literal(host)) return false;
  // Single-label names (e.g. "router", "intranet") resolve via search domains / LAN
  if (!host.includes('.')) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  const blockedSuffixes = [
    '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.private',
    '.localdomain', '.home.arpa', '.in-addr.arpa', '.ip6.arpa', '.test', '.invalid', '.example',
  ];
  if (blockedSuffixes.some((suffix) => host.endsWith(suffix))) return false;
  // Well-known cloud metadata names
  if (host === 'metadata.google.internal' || host === 'metadata' || host.startsWith('metadata.')) return false;
  // Wildcard-DNS services that map names to private IPs (127.0.0.1.nip.io etc.)
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/.test(host)) return false;
  return true;
}

/**
 * Strict brand logo src validation (1.0.8):
 * - https:// URL on a PUBLIC hostname (no IP literal, localhost, *.local,
 *   *.internal, RFC1918, 169.254/16 metadata, ::1, fe80::), with a raster
 *   image extension (png/webp/jpg/jpeg/gif). SVG is rejected.
 * - capped data:image/(png|webp|jpeg|gif);base64,… (no svg+xml)
 * Rejects javascript:…//.png, protocol-relative //evil, http-only,
 * credentials in URL, and known third-party image proxies.
 */
export function safeImageSrc(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';

  if (/^data:/i.test(value)) {
    if (value.length > MAX_DATA_IMAGE_CHARS) return '';
    return DATA_IMAGE.test(value) ? value : '';
  }

  if (BLOCKED_SCHEMES.test(value) || value.startsWith('//') || value.startsWith('\\')) return '';

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.port && url.port !== '443') return '';
    if (!IMAGE_EXT.test(url.pathname)) return '';
    const host = url.hostname.toLowerCase();
    if (!isPublicHostname(host)) return '';
    if (BLOCKED_IMAGE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Official filing (备案) hosts. Links to anything else are rendered as plain text. */
const FILING_HOST_ALLOWLIST = [
  'beian.miit.gov.cn',
  'beian.mps.gov.cn',
  'www.beian.gov.cn',
  'beian.gov.cn',
];

/**
 * ICP / 公安备案 link validation (1.0.8):
 * https only (legacy http:// on an official host is upgraded to https), public
 * hostname, and host must be an official filing domain
 * (beian.miit.gov.cn, beian.mps.gov.cn, *.beian.gov.cn) or another *.gov.cn
 * host. Returns '' when not matched, so the caller renders text without a link.
 */
export function safeFilingUrl(raw: string | undefined | null, fallback = ''): string {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  const href = safeHttpUrl(value, '');
  if (!href) return '';
  try {
    const url = new URL(href);
    if (url.port && url.port !== '443' && url.port !== '80') return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!isPublicHostname(host)) return '';
    const allowed = FILING_HOST_ALLOWLIST.includes(host)
      || host.endsWith('.beian.gov.cn')
      || host.endsWith('.gov.cn');
    if (!allowed) return '';
    // Official gov.cn hosts all serve https: upgrade legacy http:// configs instead of dropping them.
    if (url.protocol === 'http:') { url.protocol = 'https:'; url.port = ''; }
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Clamp admin free-text to a max number of code points (avoids splitting surrogate pairs). */
export function truncateText(raw: string | undefined | null, max: number): string {
  const value = (raw ?? '').trim();
  const chars = [...value];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : value;
}

/**
 * Komari always serves its built-in admin SPA for /admin* regardless of the
 * active theme (and newer builds 302 /admin → /admin/dashboard), so a plain
 * navigation is enough; no need to probe the server first.
 */
export function redirectToAdmin(): void {
  window.location.assign('/admin');
}
