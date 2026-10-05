import { mockLive, mockNodes, mockSettings } from './mock';
import type { LiveState, LoadMode, NodeInfo, PublicSettings, GpuDetail, PingStat } from './types';

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload?.status && payload.status !== 'success') throw new Error(payload.message || '请求失败');
  return payload?.data ?? payload;
}

/**
 * `?demo=1` mock mode. 1.0.8: hard-disabled in production builds
 * (import.meta.env.PROD) so a shared link cannot render fake servers on a
 * real status page. Available only under `vite dev`.
 */
export function isDemoRequested(): boolean {
  if (import.meta.env.PROD) return false;
  return wantsDemo();
}

function wantsDemo(): boolean {
  if (import.meta.env.PROD) return false;
  try {
    const params = new URLSearchParams(location.search);
    return params.get('demo') === '1' || params.get('demo') === 'true';
  } catch {
    return false;
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sanitizeUuidKey(key: string): string | null {
  const trimmed = String(key || '').trim();
  if (!trimmed || trimmed.length > 128) return null;
  // UUIDs and simple node ids; reject prototype pollution keys
  if (trimmed === '__proto__' || trimmed === 'constructor' || trimmed === 'prototype') return null;
  return trimmed;
}

/**
 * GPU from a status record. Komari 1.5+ (common:getNodesLatestStatus) sends a
 * flat `gpu` number that is always present (0 without a GPU) plus top-level
 * `gpu_count` / `gpu_average_usage` / `gpu_detailed_info` only when a GPU is
 * reported; the legacy /api/clients socket sends a nested `gpu` object.
 * Returns undefined unless a GPU is actually reported, so GPU-less nodes do
 * not render a permanent "GPU 0%" bar.
 */
function parseGpu(value: Record<string, unknown>): LiveState['gpu'] | undefined {
  const nested = asRecord(value.gpu);
  const detailsRaw = value.gpu_detailed_info ?? nested?.detailed_info ?? nested?.details;
  let details: GpuDetail[] | undefined;
  if (Array.isArray(detailsRaw)) {
    details = detailsRaw.slice(0, 16).map((item) => {
      const d = asRecord(item) || {};
      const utilization = finiteNumber(d.utilization ?? d.usage, Number.NaN);
      const temperature = finiteNumber(d.temperature ?? d.temp, Number.NaN);
      return {
        name: typeof d.name === 'string' ? d.name.slice(0, 128) : undefined,
        memory_total: finiteNumber(d.memory_total, 0) || undefined,
        memory_used: finiteNumber(d.memory_used, 0) || undefined,
        utilization: Number.isFinite(utilization) ? utilization : undefined,
        temperature: Number.isFinite(temperature) ? temperature : undefined,
      };
    });
  }
  const count = finiteNumber(value.gpu_count ?? nested?.count, Number.NaN);
  const usage = finiteNumber(
    value.gpu_average_usage ?? (nested ? nested.average_usage ?? nested.usage : value.gpu),
    Number.NaN,
  );
  const reported = (Number.isFinite(count) && count > 0) || Boolean(details?.length) || (Number.isFinite(usage) && usage > 0);
  if (!reported) return undefined;
  return {
    usage: Number.isFinite(usage) ? Math.max(0, Math.min(100, usage)) : undefined,
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : details?.length || undefined,
    details,
  };
}

/**
 * Komari 1.5+ `ping` is `{ [taskId]: { name, latest, avg, loss, min, max, tail } }`
 * over the last hour (latest is -1 and avg 0 when every sample was lost).
 * Older builds sent plain numbers; both shapes are accepted.
 */
function parsePing(value: unknown): Record<string, PingStat> {
  const ping: Record<string, PingStat> = {};
  const src = asRecord(value);
  if (!src) return ping;
  for (const [key, raw] of Object.entries(src).slice(0, 64)) {
    const safeKey = sanitizeUuidKey(key);
    if (!safeKey) continue;
    if (typeof raw === 'number' || typeof raw === 'string') {
      const n = finiteNumber(raw, Number.NaN);
      if (Number.isFinite(n) && n >= 0) ping[safeKey] = { avg: n, latest: n };
      continue;
    }
    const stat = asRecord(raw);
    if (!stat) continue;
    const avg = finiteNumber(stat.avg, Number.NaN);
    const latest = finiteNumber(stat.latest, Number.NaN);
    const loss = finiteNumber(stat.loss, Number.NaN);
    const valid = Number.isFinite(latest) ? latest >= 0 : Number.isFinite(avg) && avg >= 0;
    ping[safeKey] = {
      name: typeof stat.name === 'string' ? stat.name.trim().slice(0, 64) : undefined,
      avg: !valid ? null : Number.isFinite(avg) && avg >= 0 ? avg : latest,
      latest: valid && Number.isFinite(latest) ? latest : undefined,
      loss: Number.isFinite(loss) ? loss : undefined,
    };
  }
  return ping;
}

/**
 * Read a metric that may be flat (`cpu: 12`) or nested (`cpu: { usage: 12 }`).
 * 1.0.8: the old `value.cpu ?? asRecord(value.cpu)?.usage` never reached the
 * nested branch (an object is not nullish), silently showing 0%.
 */
function metric(flat: unknown, nested: unknown, key: string): unknown {
  if (flat != null && typeof flat !== 'object') return flat;
  const record = asRecord(nested);
  return record ? record[key] : undefined;
}

/** Light-validate a raw NodeStatus / live payload into LiveState. */
export function mapRawStatus(raw: unknown): LiveState | null {
  const value = asRecord(raw);
  if (!value) return null;

  // RPC2 sends a flat `connections` that is TCP + UDP; the legacy socket sends { tcp, udp }.
  const udp = finiteNumber(metric(value.connections_udp, value.connections, 'udp'), 0);
  const nestedConnections = asRecord(value.connections);
  const tcp = nestedConnections
    ? finiteNumber(nestedConnections.tcp, 0)
    : Math.max(0, finiteNumber(value.connections, 0) - udp);

  return {
    cpu: { usage: finiteNumber(metric(value.cpu, value.cpu, 'usage'), 0) },
    gpu: parseGpu(value),
    ram: {
      used: finiteNumber(metric(value.ram, value.ram, 'used'), 0),
      total: finiteNumber(metric(value.ram_total, value.ram, 'total'), 0),
    },
    swap: {
      used: finiteNumber(metric(value.swap, value.swap, 'used'), 0),
      total: finiteNumber(metric(value.swap_total, value.swap, 'total'), 0),
    },
    disk: {
      used: finiteNumber(metric(value.disk, value.disk, 'used'), 0),
      total: finiteNumber(metric(value.disk_total, value.disk, 'total'), 0),
    },
    network: {
      up: finiteNumber(metric(value.net_out, value.network, 'up'), 0),
      down: finiteNumber(metric(value.net_in, value.network, 'down'), 0),
      totalUp: finiteNumber(metric(value.net_total_out ?? value.net_total_up, value.network, 'totalUp'), 0),
      totalDown: finiteNumber(metric(value.net_total_in ?? value.net_total_down, value.network, 'totalDown'), 0),
    },
    load: {
      load1: finiteNumber(metric(value.load, value.load, 'load1'), 0),
      load5: finiteNumber(metric(value.load5, value.load, 'load5'), 0),
      load15: finiteNumber(metric(value.load15, value.load, 'load15'), 0),
    },
    connections: { tcp, udp },
    uptime: finiteNumber(value.uptime, 0),
    process: finiteNumber(value.process, 0),
    temp: (() => {
      const t = finiteNumber(value.temp, Number.NaN);
      return Number.isFinite(t) ? t : undefined;
    })(),
    ping: parsePing(value.ping),
    updated_at: (typeof value.time === 'string' ? value.time : typeof value.updated_at === 'string' ? value.updated_at : '').slice(0, 64),
  };
}

function mapStatusMap(result: unknown): { online: string[]; live: Record<string, LiveState> } {
  const online: string[] = [];
  const live: Record<string, LiveState> = {};
  const entries = asRecord(result);
  if (!entries) return { online, live };

  for (const [uuid, raw] of Object.entries(entries)) {
    const safeUuid = sanitizeUuidKey(uuid);
    if (!safeUuid) continue;
    const value = asRecord(raw) || {};
    const mapped = mapRawStatus(value);
    if (!mapped) continue;
    live[safeUuid] = mapped;
    // 1.0.8 (Grok M-02): strict boolean, and the online id is always the
    // dictionary key — a record cannot mark a *different* uuid as online.
    if (value.online === true) online.push(safeUuid);
  }
  return { online, live };
}

const clip = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, max) : undefined;
const optionalNumber = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * 1.0.8 (Grok L-02 / M-04): map /api/nodes to an explicit field list.
 * Drops anything not rendered (token, ipv4, ipv6, …), sanitizes uuid like
 * live-state keys, and caps string lengths before they reach React state.
 */
function sanitizeNodes(raw: unknown[]): NodeInfo[] {
  const seen = new Set<string>();
  const out: NodeInfo[] = [];
  for (const item of raw.slice(0, 1000)) {
    const n = asRecord(item);
    if (!n || typeof n.uuid !== 'string' || typeof n.name !== 'string') continue;
    const uuid = sanitizeUuidKey(n.uuid);
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    out.push({
      uuid,
      name: n.name.slice(0, 128),
      region: clip(n.region, 64),
      group: clip(n.group, 64),
      virtualization: clip(n.virtualization, 64),
      arch: clip(n.arch, 32),
      os: clip(n.os, 128),
      cpu_name: clip(n.cpu_name, 128),
      cpu_cores: optionalNumber(n.cpu_cores),
      mem_total: optionalNumber(n.mem_total),
      swap_total: optionalNumber(n.swap_total),
      disk_total: optionalNumber(n.disk_total),
      public_remark: clip(n.public_remark, 1000),
      price: optionalNumber(n.price),
      billing_cycle: optionalNumber(n.billing_cycle),
      auto_renewal: typeof n.auto_renewal === 'boolean' ? n.auto_renewal : undefined,
      currency: clip(n.currency, 16),
      expired_at: typeof n.expired_at === 'string' ? n.expired_at.slice(0, 64) : null,
      gpu_name: clip(n.gpu_name, 128),
    });
  }
  return out;
}

export async function loadInitialData(): Promise<{
  settings: PublicSettings;
  nodes: NodeInfo[];
  live: Record<string, LiveState>;
  mode: LoadMode;
  demo: boolean;
  error?: string;
}> {
  // Inline PROD check so the mock module is tree-shaken out of production bundles.
  if (!import.meta.env.PROD && wantsDemo()) {
    return { settings: mockSettings, nodes: mockNodes, live: mockLive, mode: 'demo', demo: true };
  }

  const [settingsResult, nodesResult] = await Promise.allSettled([
    request<PublicSettings>('/api/public'),
    request<NodeInfo[]>('/api/nodes'),
  ]);
  const settings = settingsResult.status === 'fulfilled' && settingsResult.value && typeof settingsResult.value === 'object'
    ? settingsResult.value : {};

  if (nodesResult.status === 'fulfilled') {
    const nodes = nodesResult.value;
    return {
      settings,
      nodes: Array.isArray(nodes) ? sanitizeNodes(nodes) : [],
      live: {},
      mode: 'live',
      demo: false,
    };
  }

  // Private site: /api/public stays readable for the login page while node data
  // is denied to guests, so ask the visitor to sign in instead of "API offline".
  if (settings.private_site === true) {
    return { settings, nodes: [], live: {}, mode: 'private', demo: false };
  }

  const error = nodesResult.reason;
  return {
    settings,
    nodes: [],
    live: {},
    mode: 'offline',
    demo: false,
    error: error instanceof Error ? error.message.slice(0, 200) : 'API unavailable',
  };
}

type PingRecords = {
  records?: Array<{ task_id?: number | string; value?: number; time?: string }>;
  tasks?: Array<{ id?: number | string; task_id?: number | string; name?: string; avg?: number }>;
};

export type NetworkLatency = { taskId: number; name: string; latency: number | null };

let rpcId = 0;

async function rpc2Http<T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/rpc2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {}, id: ++rpcId }),
    signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.error.message || 'RPC2 request failed');
  return payload?.result as T;
}

/** Prefer public/common RPC for ping records; REST last. */
async function fetchPingRecords(uuid: string): Promise<PingRecords> {
  try {
    const result = await rpc2Http<PingRecords>('public:getPingRecords', { uuid, hours: '1' });
    if (result && typeof result === 'object') return result;
  } catch { /* try common */ }
  try {
    const result = await rpc2Http<PingRecords>('common:getRecords', { type: 'ping', uuid, hours: 1, maxCount: 500 });
    if (result && typeof result === 'object') return result;
  } catch { /* REST fallback */ }
  return request<PingRecords>(`/api/records/ping?uuid=${encodeURIComponent(uuid)}&hours=1`);
}

async function fetchPublicPingTasks(): Promise<Array<Record<string, unknown>>> {
  try {
    const result = await rpc2Http<Array<Record<string, unknown>>>('public:getPublicPingTasks');
    if (Array.isArray(result)) return result;
  } catch { /* REST */ }
  return request<Array<Record<string, unknown>>>('/api/task/ping');
}

/** Concurrency-limited map to debounce ping fan-out. */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function loadPingLatencies(nodeIds: string[]) {
  const capped = nodeIds.slice(0, 64);
  let hasTasks = false;
  try {
    const tasks = await fetchPublicPingTasks();
    hasTasks = Array.isArray(tasks) && tasks.some((task) => task.enabled !== false && task.disabled !== true);
  } catch {
    // Older Komari may lack a public task endpoint: keep the history-record
    // compatibility path (capped at 64 nodes, 4 concurrent, paused when hidden).
    hasTasks = true;
  }

  if (!hasTasks) {
    return { values: Object.fromEntries(capped.map((uuid) => [uuid, null])) as Record<string, number | null>, hasTasks: false };
  }

  const entries = await mapPool(capped, 4, async (uuid) => {
    try {
      const data = await fetchPingRecords(uuid);
      const taskValues = (data.tasks || []).map((task) => Number(task.avg)).filter((value) => Number.isFinite(value) && value >= 0);
      if (taskValues.length) return [uuid, Math.round(taskValues.reduce((sum, value) => sum + value, 0) / taskValues.length)] as const;
      const latest = [...(data.records || [])].reverse().find((record) => Number(record.value) >= 0);
      return [uuid, latest ? Math.round(Number(latest.value)) : null] as const;
    } catch {
      return [uuid, null] as const;
    }
  });
  return { values: Object.fromEntries(entries) as Record<string, number | null>, hasTasks: true };
}

export async function loadNetworkLatencies(nodeIds: string[], taskNames: string[]) {
  const normalizedNames = [...new Set(taskNames.map((name) => name.trim()).filter(Boolean))];
  if (!normalizedNames.length) return {} as Record<string, NetworkLatency[]>;
  const capped = nodeIds.slice(0, 64);
  let activeTaskNames: Set<string> | null = null;
  try {
    const activeTasks = await fetchPublicPingTasks();
    activeTaskNames = new Set(activeTasks
      .filter((task) => task.enabled !== false && task.disabled !== true)
      .map((task) => (typeof task.name === 'string' ? task.name.trim() : ''))
      .filter(Boolean));
  } catch {
    // use records
  }

  const entries = await mapPool(capped, 4, async (uuid) => {
    try {
      const data = await fetchPingRecords(uuid);
      const tasks = data.tasks || [];
      const records = data.records || [];
      const values = normalizedNames.flatMap<NetworkLatency>((configuredName) => {
        if (activeTaskNames && !activeTaskNames.has(configuredName)) return [];
        const task = tasks.find((candidate) => candidate.name?.trim() === configuredName);
        if (!task) return [];
        const taskId = Number(task.id ?? task.task_id);
        if (!Number.isFinite(taskId) || taskId <= 0) return [];
        const taskAverage = typeof task.avg === 'number' ? task.avg : Number.NaN;
        if (Number.isFinite(taskAverage) && taskAverage >= 0) {
          return [{ taskId, name: configuredName, latency: Math.round(taskAverage) }];
        }
        const samples = records
          .filter((record) => Number(record.task_id) === taskId)
          .map((record) => Number(record.value))
          .filter((value) => Number.isFinite(value) && value >= 0);
        if (!samples.length) return [{ taskId, name: configuredName, latency: null }];
        return [{ taskId, name: configuredName, latency: Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) }];
      });
      return [uuid, values] as const;
    } catch {
      return [uuid, []] as const;
    }
  });
  return Object.fromEntries(entries) as Record<string, NetworkLatency[]>;
}

/**
 * Live status: prefer RPC2 WebSocket, then RPC2 HTTP POST, then legacy WS /api/clients.
 */
export function connectLive(
  onData: (online: string[], live: Record<string, LiveState>) => void,
  onStatus: (connected: boolean) => void,
  requestedInterval = 5000,
) {
  if (!location.protocol.startsWith('http')) return () => undefined;
  const interval = Math.max(1000, Math.min(60000, requestedInterval));
  let timer: number | undefined;
  let controller: AbortController | undefined;
  let rpcSocket: WebSocket | undefined;
  let legacySocket: WebSocket | undefined;
  let stopped = false;
  let running = false;
  let requestId = 0;
  let rpcWsFailed = false;
  /** Timestamp of the last successful RPC2-over-WebSocket delivery. */
  let lastWsDelivery = 0;
  const MAX_FRAME_CHARS = 4_000_000;
  const wsHealthy = () => Boolean(rpcSocket && rpcSocket.readyState === WebSocket.OPEN
    && lastWsDelivery > 0 && Date.now() - lastWsDelivery < interval * 3);

  const schedule = () => {
    if (!stopped && !document.hidden) timer = window.setTimeout(refresh, interval);
  };

  const deliver = (online: string[], live: Record<string, LiveState>) => {
    if (stopped) return;
    onData(online, live);
    onStatus(true);
  };

  const openRpcSocket = () => {
    if (rpcWsFailed) return;
    if (rpcSocket && rpcSocket.readyState < WebSocket.CLOSING) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      rpcSocket = new WebSocket(`${scheme}//${location.host}/api/rpc2`);
    } catch {
      rpcWsFailed = true;
      return;
    }
    rpcSocket.onopen = () => {
      rpcSocket?.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'common:getNodesLatestStatus',
        params: {},
        id: ++requestId,
      }));
    };
    rpcSocket.onmessage = (event) => {
      try {
        if (typeof event.data !== 'string' || event.data.length > MAX_FRAME_CHARS) return;
        const message = JSON.parse(event.data);
        if (!message || typeof message !== 'object') return;
        if (message.error) return;
        if (message.result == null) return;
        const { online, live } = mapStatusMap(message.result);
        lastWsDelivery = Date.now();
        deliver(online, live);
        legacySocket?.close();
        legacySocket = undefined;
      } catch { /* ignore malformed frames */ }
    };
    rpcSocket.onerror = () => {
      rpcSocket?.close();
    };
    rpcSocket.onclose = () => {
      rpcSocket = undefined;
      // If RPC WS never delivered, mark failed so we lean on HTTP + legacy.
      // If it did work before, allow one reconnect on the next tick.
      if (!stopped && lastWsDelivery === 0) rpcWsFailed = true;
      lastWsDelivery = 0;
    };
  };

  const openLegacySocket = () => {
    if (legacySocket && legacySocket.readyState < WebSocket.CLOSING) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    legacySocket = new WebSocket(`${scheme}//${location.host}/api/clients`);
    legacySocket.onopen = () => legacySocket?.send('get');
    legacySocket.onmessage = (event) => {
      try {
        if (typeof event.data !== 'string' || event.data.length > MAX_FRAME_CHARS) return;
        const message = JSON.parse(event.data);
        if (!message || typeof message !== 'object') return;
        const payload = message?.data?.data ? message.data : message?.data;
        if (!payload || typeof payload !== 'object') return;
        const dataMap = asRecord(payload.data);
        if (!dataMap) return;
        const onlineRaw: string[] = Array.isArray(payload.online)
          ? payload.online.map((item: unknown) => String(item))
          : [];
        const live: Record<string, LiveState> = {};
        for (const [uuid, raw] of Object.entries(dataMap)) {
          const safeUuid = sanitizeUuidKey(uuid);
          if (!safeUuid) continue;
          const mapped = mapRawStatus(raw);
          if (mapped) live[safeUuid] = mapped;
        }
        const online = onlineRaw
          .map((id: string) => sanitizeUuidKey(id))
          .filter((id): id is string => Boolean(id));
        deliver(online, live);
      } catch { /* ignore malformed legacy frames */ }
    };
    legacySocket.onerror = () => legacySocket?.close();
    legacySocket.onclose = () => { legacySocket = undefined; };
  };

  const refresh = async () => {
    if (stopped || running || document.hidden) return;
    running = true;
    controller = new AbortController();

    // Prefer RPC2 WebSocket when available; nudge it each tick
    if (!rpcWsFailed) {
      if (!rpcSocket || rpcSocket.readyState >= WebSocket.CLOSING) {
        openRpcSocket();
      } else if (rpcSocket.readyState === WebSocket.OPEN) {
        let sent = false;
        try {
          rpcSocket.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'common:getNodesLatestStatus',
            params: {},
            id: ++requestId,
          }));
          sent = true;
        } catch { /* fall through to HTTP */ }
        // 1.0.8 (Antigravity M-02): WS is OPEN and answered recently — do not
        // dual-send the same query over HTTP. HTTP resumes automatically if
        // the socket stalls for > 3 intervals or closes.
        if (sent && wsHealthy()) {
          running = false;
          controller = undefined;
          schedule();
          return;
        }
      }
    }

    try {
      const result = await rpc2Http<Record<string, unknown>>('common:getNodesLatestStatus', {}, controller.signal);
      const { online, live } = mapStatusMap(result);
      if (!stopped) {
        // HTTP succeeded — can drop legacy socket
        legacySocket?.close();
        legacySocket = undefined;
        deliver(online, live);
      }
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) {
        onStatus(false);
        // Last resort: legacy /api/clients WS (soft-deprecated)
        openLegacySocket();
      }
    } finally {
      running = false;
      controller = undefined;
      schedule();
    }
  };

  const handleVisibility = () => {
    if (timer) window.clearTimeout(timer);
    timer = undefined;
    if (!document.hidden) void refresh();
  };

  document.addEventListener('visibilitychange', handleVisibility);
  void refresh();
  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    controller?.abort();
    rpcSocket?.close();
    legacySocket?.close();
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
