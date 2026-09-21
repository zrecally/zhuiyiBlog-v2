import { config } from '../config';

export type FeishuDataEnvironment = 'Production' | 'Test';
export type FeishuFields = Record<string, unknown>;
export type FeishuRecordLike = { fields?: FeishuFields };

const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (typeof record.name === 'string') return record.name;
        if (typeof record.text === 'string') return record.text;
      }
      return '';
    }).join('').trim();
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name.trim();
    if (typeof record.text === 'string') return record.text.trim();
  }
  return '';
};

export const isFeishuEnvironmentMatch = (
  fields: FeishuFields | undefined,
  environment: FeishuDataEnvironment = config.feishu.dataEnvironment,
  allowLegacyBlank = config.feishu.allowLegacyBlankEnvironment,
): boolean => {
  if (!fields) return false;
  const recordEnvironment = textValue(fields.Environment);
  if (!recordEnvironment) return environment === 'Production' && allowLegacyBlank;
  return recordEnvironment === environment;
};

export const filterFeishuRecordsForCurrentEnvironment = <T extends FeishuRecordLike>(records: T[]): T[] => (
  records.filter(record => isFeishuEnvironmentMatch(record.fields))
);

export const shouldBackfillCurrentFeishuEnvironment = (
  fields: FeishuFields | undefined,
  environment: FeishuDataEnvironment = config.feishu.dataEnvironment,
  allowLegacyBlank = config.feishu.allowLegacyBlankEnvironment,
): boolean => (
  Boolean(fields)
  && environment === 'Production'
  && allowLegacyBlank
  && !textValue(fields?.Environment)
);

export const withCurrentFeishuEnvironment = <T extends FeishuFields>(fields: T): T & {
  Environment: string;
} => ({
  ...fields,
  Environment: config.feishu.dataEnvironment,
});

export const feishuEnvironmentCacheSegment = (): string => (
  config.feishu.dataEnvironment === 'Production' ? '' : 'test'
);
