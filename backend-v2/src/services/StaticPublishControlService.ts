import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { StaticSnapshotResult } from './static-snapshot/StaticSnapshotWriter';

const MAX_CONTROL_FILE_BYTES = 64 * 1024;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const VERSION_PATTERN = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type StaticPublishState = 'not_configured' | 'waiting' | 'running' | 'published' | 'up_to_date' | 'failed';

export type StaticPublishTargetState = 'waiting' | 'running' | 'published' | 'up_to_date' | 'failed';

export interface StaticPublishTargetStatus {
  host: string;
  name: string | null;
  state: StaticPublishTargetState;
  message: string | null;
  publishedAt: string | null;
  version: string | null;
}

export interface StaticPublishStatus {
  configured: boolean;
  state: StaticPublishState;
  message: string;
  checkedAt: string | null;
  publishedAt: string | null;
  version: string | null;
  contentSha256: string | null;
  destination: string | null;
  // 发布器逐目标上报状态;旧版 status.json 无此字段时为 null
  targets: StaticPublishTargetStatus[] | null;
}

interface PublisherStatusFile {
  schemaVersion: 1;
  state: Exclude<StaticPublishState, 'not_configured' | 'waiting'>;
  message: string;
  checkedAt: string;
  publishedAt?: string;
  version?: string;
  contentSha256?: string;
  destination?: string;
  targets?: StaticPublishTargetStatus[];
}

const TARGET_STATES: readonly StaticPublishTargetState[] = ['waiting', 'running', 'published', 'up_to_date', 'failed'];
const MAX_TARGETS = 8;

function sanitizeTargets(value: unknown): StaticPublishTargetStatus[] | null {
  if (!Array.isArray(value)) return null;
  const targets: StaticPublishTargetStatus[] = [];
  for (const item of value.slice(0, MAX_TARGETS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.host !== 'string' || !entry.host.trim()) continue;
    if (!TARGET_STATES.includes(entry.state as StaticPublishTargetState)) continue;
    targets.push({
      host: entry.host.slice(0, 100),
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.slice(0, 40) : null,
      state: entry.state as StaticPublishTargetState,
      message: typeof entry.message === 'string' ? entry.message.slice(0, 300) : null,
      publishedAt: isIsoDate(entry.publishedAt) ? entry.publishedAt : null,
      version: typeof entry.version === 'string' && VERSION_PATTERN.test(entry.version) ? entry.version : null,
    });
  }
  return targets;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function sanitizeStatus(value: unknown): PublisherStatusFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1) return null;
  if (!['running', 'published', 'up_to_date', 'failed'].includes(String(item.state))) return null;
  if (!isIsoDate(item.checkedAt)) return null;

  return {
    schemaVersion: 1,
    state: item.state as PublisherStatusFile['state'],
    message: typeof item.message === 'string' ? item.message.slice(0, 300) : '',
    checkedAt: item.checkedAt,
    publishedAt: isIsoDate(item.publishedAt) ? item.publishedAt : undefined,
    version: typeof item.version === 'string' && VERSION_PATTERN.test(item.version) ? item.version : undefined,
    contentSha256: typeof item.contentSha256 === 'string' && SHA256_PATTERN.test(item.contentSha256)
      ? item.contentSha256
      : undefined,
    destination: typeof item.destination === 'string' ? item.destination.slice(0, 100) : undefined,
    targets: sanitizeTargets(item.targets) ?? undefined,
  };
}

async function readSmallRegularJson(fileName: string): Promise<unknown | null> {
  try {
    const stat = await fs.promises.lstat(fileName);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONTROL_FILE_BYTES) return null;
    return JSON.parse(await fs.promises.readFile(fileName, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class StaticPublishControlService {
  public static isConfigured(): boolean {
    return Boolean(config.staticPublishControl.requestDir && config.staticPublishControl.statusFile);
  }

  public static async getStatus(): Promise<StaticPublishStatus> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        state: 'not_configured',
        message: '宿主机发布控制面未配置',
        checkedAt: null,
        publishedAt: null,
        version: null,
        contentSha256: null,
        destination: null,
        targets: null,
      };
    }

    const parsed = sanitizeStatus(await readSmallRegularJson(config.staticPublishControl.statusFile));
    if (!parsed) {
      return {
        configured: true,
        state: 'waiting',
        message: '等待宿主机发布器首次上报状态',
        checkedAt: null,
        publishedAt: null,
        version: null,
        contentSha256: null,
        destination: null,
        targets: null,
      };
    }

    return {
      configured: true,
      state: parsed.state,
      message: parsed.message,
      checkedAt: parsed.checkedAt,
      publishedAt: parsed.publishedAt || null,
      version: parsed.version || null,
      contentSha256: parsed.contentSha256 || null,
      destination: parsed.destination || null,
      targets: parsed.targets ?? null,
    };
  }

  public static async requestPublish(snapshot: StaticSnapshotResult, requestedBy: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('宿主机发布控制面未配置');
    if (!VERSION_PATTERN.test(snapshot.version)) throw new Error('静态快照版本格式无效');

    const requestDir = config.staticPublishControl.requestDir;
    await fs.promises.mkdir(requestDir, { recursive: true, mode: 0o750 });
    const requestFile = path.join(requestDir, 'request.json');
    const temporaryFile = path.join(requestDir, `.request-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
    const payload = `${JSON.stringify({
      schemaVersion: 1,
      requestedAt: new Date().toISOString(),
      requestedBy: requestedBy.slice(0, 100),
      version: snapshot.version,
      changed: snapshot.changed,
      nonce: randomBytes(16).toString('hex'),
    })}\n`;

    try {
      await fs.promises.writeFile(temporaryFile, payload, { flag: 'wx', mode: 0o640 });
      await fs.promises.rename(temporaryFile, requestFile);
    } catch (error) {
      await fs.promises.rm(temporaryFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
