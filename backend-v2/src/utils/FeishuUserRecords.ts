export type FeishuUserRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
  created_time?: string | number;
  last_modified_time?: string | number;
};

export type LatestFeishuUserRecord = {
  email: string;
  canonical: FeishuUserRecord;
  duplicates: FeishuUserRecord[];
};

export const readFeishuText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    if (item && typeof item === 'object') {
      const objectItem = item as { text?: unknown; name?: unknown };
      return String(objectItem.text || objectItem.name || '');
    }
    return '';
  }).join('').trim();
};

export const normalizeFeishuUserEmail = (fields: Record<string, unknown> | undefined): string => (
  readFeishuText(fields?.Email).toLowerCase()
);

const timestampValue = (value: unknown): number => {
  const text = readFeishuText(value);
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric > 0 && numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const feishuUserRecordFreshness = (record: FeishuUserRecord): number => Math.max(
  timestampValue(record.fields?.LastLogin),
  timestampValue(record.last_modified_time),
  timestampValue(record.created_time),
);

export const selectLatestFeishuUserRecords = (
  records: FeishuUserRecord[],
): LatestFeishuUserRecord[] => {
  const recordsByEmail = new Map<string, FeishuUserRecord[]>();
  for (const record of records) {
    const email = normalizeFeishuUserEmail(record.fields);
    if (!email) continue;
    const group = recordsByEmail.get(email) || [];
    group.push(record);
    recordsByEmail.set(email, group);
  }

  return Array.from(recordsByEmail.entries()).map(([email, group]) => {
    const sorted = [...group].sort((left, right) => {
      const freshnessDifference = feishuUserRecordFreshness(right) - feishuUserRecordFreshness(left);
      if (freshnessDifference !== 0) return freshnessDifference;
      return String(right.record_id || '').localeCompare(String(left.record_id || ''));
    });
    return { email, canonical: sorted[0], duplicates: sorted.slice(1) };
  });
};
