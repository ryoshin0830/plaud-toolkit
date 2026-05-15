import * as zlib from 'zlib';
import { PlaudAuth } from './auth.js';
import { resolveBaseUrl, PLAUD_USER_AGENT } from './types.js';
import type { PlaudRecording, PlaudRecordingDetail, PlaudUserInfo, TranscriptSegment } from './types.js';

const REGION_RE = /^(?:https?:\/\/)?api(?:-([a-z0-9]+))?\.plaud\.ai/i;

function parseRegionFromDomain(domain: string): string {
  const m = REGION_RE.exec(domain);
  return m?.[1]?.toLowerCase() ?? 'us';
}

function looksLikeCloudflareBlock(body: string): boolean {
  return /cloudflare|cf-ray|attention required|just a moment/i.test(body);
}

export class PlaudClient {
  private auth: PlaudAuth;
  private region: string;

  constructor(auth: PlaudAuth, region: string = 'us') {
    this.auth = auth;
    this.region = region;
  }

  private get baseUrl(): string {
    return resolveBaseUrl(this.region);
  }

  private async request(path: string, options?: RequestInit): Promise<any> {
    const token = await this.auth.getToken();
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': PLAUD_USER_AGENT,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 403 && looksLikeCloudflareBlock(body)) {
        throw new Error(
          `Plaud API error: 403 Forbidden (blocked by Cloudflare). ` +
          `The User-Agent may have been flagged. Try setting PLAUD_USER_AGENT ` +
          `to a current desktop browser UA string and retry.`
        );
      }
      throw new Error(`Plaud API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Handle region mismatch
    if (data?.status === -302 && data?.data?.domains?.api) {
      const newRegion = parseRegionFromDomain(data.data.domains.api);
      if (newRegion === this.region) {
        throw new Error(`Plaud region redirect loop for '${newRegion}'`);
      }
      this.region = newRegion;
      return this.request(path, options);
    }

    return data;
  }

  async listRecordings(): Promise<PlaudRecording[]> {
    const data = await this.request('/file/simple/web');
    const list: PlaudRecording[] = data.data_file_list ?? data.data ?? [];
    return list.filter(r => !r.is_trash);
  }

  async getRecording(id: string): Promise<PlaudRecordingDetail> {
    const data = await this.request(`/file/detail/${id}`);
    const raw = data.data ?? data;

    // `pre_download_content_list` holds AI-generated blobs (marks, summary,
    // outline) — NOT the verbatim transcript. For the actual speech transcript,
    // callers should use `getTranscript()`, which fetches the gzipped JSON
    // from the `transaction` item's signed S3 URL in `content_list`.
    return {
      ...raw,
      id: raw.file_id ?? id,
      filename: raw.file_name ?? raw.filename ?? id,
      transcript: '',
    } as PlaudRecordingDetail;
  }

  async getTranscript(id: string): Promise<TranscriptSegment[]> {
    const data = await this.request(`/file/detail/${id}`);
    const raw = data.data ?? data;
    const list: any[] = raw.content_list ?? [];
    const tx = list.find(it => it?.data_type === 'transaction');
    if (!tx?.data_link) return [];

    const res = await fetch(tx.data_link);
    if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status} ${res.statusText}`);
    // Some fetch implementations (undici) transparently decompress responses
    // whose Content-Encoding is gzip; others return the raw gzip bytes. Detect
    // the gzip magic number and decompress manually only when needed.
    const buf = Buffer.from(await res.arrayBuffer());
    const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    const text = isGzip ? zlib.gunzipSync(buf).toString('utf-8') : buf.toString('utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed as TranscriptSegment[] : [];
  }

  async getUserInfo(): Promise<PlaudUserInfo> {
    const data = await this.request('/user/me');
    const user = data.data_user ?? data.data ?? data;
    return {
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      country: user.country,
      membership_type: data.data_state?.membership_type ?? 'unknown',
    };
  }

  async downloadAudio(id: string): Promise<ArrayBuffer> {
    const token = await this.auth.getToken();
    const res = await fetch(`${this.baseUrl}/file/download/${id}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': PLAUD_USER_AGENT },
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.arrayBuffer();
  }

  async getMp3Url(id: string): Promise<string | null> {
    try {
      const data = await this.request(`/file/temp-url/${id}?is_opus=false`);
      return data?.url ?? data?.data?.url ?? data?.data ?? data?.temp_url ?? null;
    } catch {
      return null;
    }
  }
}
