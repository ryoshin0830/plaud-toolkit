export type PlaudAuthMode = 'password' | 'sso';

export interface PlaudCredentials {
  region: string;
  email?: string;
  password?: string;
  authMode?: PlaudAuthMode; // absent = 'password' (back-compat)
}

export interface PlaudTokenData {
  accessToken: string;
  tokenType: string;
  issuedAt: number;   // epoch ms
  expiresAt: number;  // epoch ms (decoded from JWT)
}

export interface PlaudConfig {
  credentials?: PlaudCredentials;
  token?: PlaudTokenData;
}

export const BASE_URLS: Record<string, string> = {
  us: 'https://api.plaud.ai',
  eu: 'https://api-euc1.plaud.ai',
  euc1: 'https://api-euc1.plaud.ai',
  apne1: 'https://api-apne1.plaud.ai',
};

// Plaud JWTs carry a `region` claim in AWS format (e.g. `aws:ap-northeast-1`),
// while API hostnames use short codes (`apne1`). Normalize known values; pass
// anything else through untouched so callers can still try it via resolveBaseUrl.
const JWT_REGION_ALIASES: Record<string, string> = {
  'aws:us-east-1': 'us',
  'aws:eu-central-1': 'euc1',
  'aws:ap-northeast-1': 'apne1',
};

export function normalizeRegion(raw: string): string {
  return JWT_REGION_ALIASES[raw] ?? raw;
}

export function resolveBaseUrl(region: string): string {
  return BASE_URLS[region] ?? `https://api-${region}.plaud.ai`;
}

// Plaud's API sits behind Cloudflare, which 403s requests with Node's default
// User-Agent (the response body is the CF challenge HTML). Send a browser-like
// UA on every API call. Override via `PLAUD_USER_AGENT` if CF later rejects
// this specific string and the toolkit hasn't been updated yet.
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
export const PLAUD_USER_AGENT = process.env.PLAUD_USER_AGENT || DEFAULT_USER_AGENT;

export interface PlaudRecording {
  id: string;
  filename: string;
  fullname: string;
  filesize: number;
  duration: number;
  start_time: number;
  end_time: number;
  is_trash: boolean;
  is_trans: boolean;
  is_summary: boolean;
  keywords: string[];
  serial_number: string;
}

export interface PlaudRecordingDetail extends PlaudRecording {
  transcript: string;
  summary?: string;
}

export interface TranscriptSegment {
  start_time: number;   // ms from start
  end_time: number;     // ms from start
  content: string;
  speaker: string;
  original_speaker?: string;
}

export interface PlaudUserInfo {
  id: string;
  nickname: string;
  email: string;
  country: string;
  membership_type: string;
}
