export interface NodeInfo {
  uuid: string;
  name: string;
  region?: string;
  group?: string;
  virtualization?: string;
  arch?: string;
  os?: string;
  cpu_name?: string;
  cpu_cores?: number;
  mem_total?: number;
  swap_total?: number;
  disk_total?: number;
  public_remark?: string;
  price?: number;
  billing_cycle?: number;
  auto_renewal?: boolean;
  currency?: string;
  expired_at?: string | null;
  /** Komari 1.5+ optional GPU name from node info */
  gpu_name?: string;
}

export interface GpuDetail {
  name?: string;
  memory_total?: number;
  memory_used?: number;
  utilization?: number;
  temperature?: number;
}

export interface LiveState {
  cpu?: { usage?: number };
  /** Average GPU utilization 0–100 when reported (Komari 1.5+) */
  gpu?: { usage?: number; count?: number; details?: GpuDetail[] };
  ram?: { total?: number; used?: number };
  swap?: { total?: number; used?: number };
  disk?: { total?: number; used?: number };
  network?: { up?: number; down?: number; totalUp?: number; totalDown?: number };
  load?: { load1?: number; load5?: number; load15?: number };
  connections?: { tcp?: number; udp?: number };
  uptime?: number;
  process?: number;
  temp?: number;
  /** Komari 1.5+: per-task ping stats keyed by task id (1h window, from common:getNodesLatestStatus) */
  ping?: Record<string, PingStat>;
  updated_at?: string;
}

export interface PingStat {
  name?: string;
  /** Average latency (ms) over valid samples; null when every sample was lost */
  avg: number | null;
  latest?: number;
  loss?: number;
}

export interface PublicSettings {
  sitename?: string;
  description?: string;
  disable_password_login?: boolean;
  oauth_enable?: boolean;
  oauth_provider?: string;
  private_site?: boolean;
  theme_settings?: {
    show_dashboard?: boolean;
    show_footer?: boolean;
    show_latency?: boolean;
    show_network_latency?: boolean;
    network_latency_order?: string;
    data_update_interval?: number;
    offline_nodes_last?: boolean;
    default_sort?: string;
    show_icp?: boolean;
    icp_number?: string;
    icp_url?: string;
    show_police_filing?: boolean;
    police_filing_number?: string;
    police_filing_url?: string;
    footer_content?: string;
    brand_title?: string;
    brand_subtitle?: string;
    brand_logo_url?: string;
  };
}

export type LoadMode = 'live' | 'offline' | 'private' | 'demo';
