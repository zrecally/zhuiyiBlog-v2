import { prisma } from '../core/Database';
import { config } from '../config';

export const PRODUCT_POLL_ID = 'product-roadmap-2026';
const PRODUCT_POLL_CONFIG_KEY = `poll_definition_${PRODUCT_POLL_ID}`;

export const PRODUCT_POLL_OPTIONS = Object.freeze({
  'feedback-ui': Object.freeze(['pigeon-post', 'fax-machine']),
  'next-module': Object.freeze(['ai-assistant', 'community-forum', 'data-analytics']),
});

export type ProductPollCategoryId = keyof typeof PRODUCT_POLL_OPTIONS;
export type ProductPollSelections = Record<ProductPollCategoryId, string>;
export type ProductPollPreview = 'pigeon' | 'fax' | null;

export interface ProductPollOptionDefinition {
  id: string;
  title: string;
  description: string;
  preview: ProductPollPreview;
  previewEnabled: boolean;
  previewUrl: string;
}

export interface ProductPollCategoryDefinition {
  id: ProductPollCategoryId;
  title: string;
  description: string;
  options: ProductPollOptionDefinition[];
}

export interface ProductPollDefinition {
  enabled: boolean;
  title: string;
  description: string;
  categories: ProductPollCategoryDefinition[];
}

export interface ProductPollResults {
  totalVotes: number;
  categories: Record<ProductPollCategoryId, Record<string, number>>;
}

export const DEFAULT_PRODUCT_POLL_DEFINITION: ProductPollDefinition = {
  enabled: true,
  title: '产品功能投票',
  description: '请选择你更希望优先上线的功能。每个登录账号可以提交一次，提交后不可修改。',
  categories: [
    {
      id: 'feedback-ui',
      title: '反馈入口形式',
      description: '选择你更喜欢的反馈交互方式。',
      options: [
        {
          id: 'pigeon-post',
          title: '动画信件',
          description: '通过动画和信件形式提交反馈，强调操作过程和视觉体验。',
          preview: 'pigeon',
          previewEnabled: true,
          previewUrl: '',
        },
        {
          id: 'fax-machine',
          title: '传真界面',
          description: '通过复古传真机界面提交反馈，操作方式直接、状态清晰。',
          preview: 'fax',
          previewEnabled: true,
          previewUrl: '',
        },
      ],
    },
    {
      id: 'next-module',
      title: '后续功能优先级',
      description: '选择你最希望下一阶段优先开发的功能。',
      options: [
        {
          id: 'ai-assistant',
          title: '写作辅助',
          description: '提供内容润色、结构建议和灵感整理功能。',
          preview: null,
          previewEnabled: false,
          previewUrl: '',
        },
        {
          id: 'community-forum',
          title: '交流社区',
          description: '提供作品展示、主题讨论和用户交流功能。',
          preview: null,
          previewEnabled: false,
          previewUrl: '',
        },
        {
          id: 'data-analytics',
          title: '数据统计',
          description: '展示阅读趋势、内容表现和访问数据。',
          preview: null,
          previewEnabled: false,
          previewUrl: '',
        },
      ],
    },
  ],
};

const categoryIds = Object.keys(PRODUCT_POLL_OPTIONS) as ProductPollCategoryId[];

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function previewUrlValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > 2048) return null;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || !config.preview.allowedHosts.includes(url.hostname.toLocaleLowerCase())
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseProductPollDefinition(value: unknown): ProductPollDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean' || !Array.isArray(record.categories)) return null;
  const title = textValue(record.title, 80);
  const description = textValue(record.description, 300);
  if (!title || !description || record.categories.length !== categoryIds.length) return null;

  const categories: ProductPollCategoryDefinition[] = [];
  for (const defaultCategory of DEFAULT_PRODUCT_POLL_DEFINITION.categories) {
    const rawCategory = record.categories.find((item) => (
      item && typeof item === 'object' && !Array.isArray(item)
      && (item as Record<string, unknown>).id === defaultCategory.id
    )) as Record<string, unknown> | undefined;
    if (!rawCategory || !Array.isArray(rawCategory.options)) return null;
    const categoryTitle = textValue(rawCategory.title, 80);
    const categoryDescription = textValue(rawCategory.description, 200);
    if (!categoryTitle || !categoryDescription || rawCategory.options.length !== defaultCategory.options.length) return null;

    const options: ProductPollOptionDefinition[] = [];
    for (const defaultOption of defaultCategory.options) {
      const rawOption = rawCategory.options.find((item) => (
        item && typeof item === 'object' && !Array.isArray(item)
        && (item as Record<string, unknown>).id === defaultOption.id
      )) as Record<string, unknown> | undefined;
      if (!rawOption || typeof rawOption.previewEnabled !== 'boolean') return null;
      const optionTitle = textValue(rawOption.title, 60);
      const optionDescription = textValue(rawOption.description, 240);
      const previewUrl = previewUrlValue(rawOption.previewUrl);
      if (!optionTitle || !optionDescription || previewUrl === null) return null;
      options.push({
        id: defaultOption.id,
        title: optionTitle,
        description: optionDescription,
        preview: defaultOption.preview,
        previewEnabled: Boolean(defaultOption.preview && rawOption.previewEnabled),
        previewUrl: defaultOption.preview ? previewUrl : '',
      });
    }

    categories.push({
      id: defaultCategory.id,
      title: categoryTitle,
      description: categoryDescription,
      options,
    });
  }

  return { enabled: record.enabled, title, description, categories };
}

export async function getProductPollDefinition(): Promise<ProductPollDefinition> {
  const stored = await prisma.systemConfig.findUnique({ where: { key: PRODUCT_POLL_CONFIG_KEY } });
  if (!stored) return structuredClone(DEFAULT_PRODUCT_POLL_DEFINITION);
  try {
    return parseProductPollDefinition(JSON.parse(stored.value))
      || structuredClone(DEFAULT_PRODUCT_POLL_DEFINITION);
  } catch {
    return structuredClone(DEFAULT_PRODUCT_POLL_DEFINITION);
  }
}

export async function saveProductPollDefinition(definition: ProductPollDefinition) {
  await prisma.systemConfig.upsert({
    where: { key: PRODUCT_POLL_CONFIG_KEY },
    create: {
      key: PRODUCT_POLL_CONFIG_KEY,
      value: JSON.stringify(definition),
      isSecret: false,
    },
    update: {
      value: JSON.stringify(definition),
      isSecret: false,
    },
  });
}

export function validateProductPollSelections(value: unknown): ProductPollSelections | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== categoryIds.length) return null;

  const selections = {} as ProductPollSelections;
  for (const categoryId of categoryIds) {
    const optionId = record[categoryId];
    if (
      typeof optionId !== 'string'
      || !(PRODUCT_POLL_OPTIONS[categoryId] as readonly string[]).includes(optionId)
    ) return null;
    selections[categoryId] = optionId;
  }
  return selections;
}

export function aggregateProductPollResults(rows: Array<{ selections: unknown }>): ProductPollResults {
  const categories = {} as ProductPollResults['categories'];
  for (const categoryId of categoryIds) {
    categories[categoryId] = Object.fromEntries(
      PRODUCT_POLL_OPTIONS[categoryId].map(optionId => [optionId, 0]),
    );
  }

  let totalVotes = 0;
  for (const row of rows) {
    const selections = validateProductPollSelections(row.selections);
    if (!selections) continue;
    totalVotes += 1;
    for (const categoryId of categoryIds) {
      categories[categoryId][selections[categoryId]] += 1;
    }
  }

  return { totalVotes, categories };
}
