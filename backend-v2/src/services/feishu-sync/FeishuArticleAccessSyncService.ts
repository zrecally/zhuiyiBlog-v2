import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import { withCurrentFeishuEnvironment } from '../../utils/FeishuEnvironment';
import {
  articleCodeDigest,
  maskIpForAudit,
  normalizeArticlePassword,
  validateArticlePassword,
} from '../../utils/ArticleAccess';
import { FeishuBaseSyncService } from './FeishuBaseSyncService';

const SAFE_POST_ID = /^[A-Za-z0-9_-]{1,128}$/;

const checkboxValue = (value: unknown): boolean => {
  if (value === true) return true;
  const text = FeishuBaseSyncService.textValue(value).toLocaleLowerCase();
  return text === 'true' || text === 'yes' || text === '1' || text === '是';
};

const positiveGrantHours = (value: unknown): number => {
  const parsed = Number(FeishuBaseSyncService.textValue(value));
  if (!Number.isFinite(parsed) || parsed < 1) return 24;
  return Math.min(Math.floor(parsed), config.articleAccess.maxGrantHours);
};

const writeFeishuStatus = async (
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.articleAccessCodes) return;
  await feishuClient.bitable.appTableRecord.update({
    path: {
      app_token: config.feishu.baseToken,
      table_id: config.feishu.tables.articleAccessCodes,
      record_id: recordId,
    },
    data: { fields: withCurrentFeishuEnvironment(fields) as any },
  });
};

export class FeishuArticleAccessSyncService {
  public static async syncToLocal() {
    if (!config.articleAccess.enabled || !config.feishu.tables.articleAccessCodes) {
      return { imported: 0, updated: 0, revoked: 0, skipped: true };
    }
    if (!config.articleAccess.pepper || config.articleAccess.pepper.length < 32) {
      throw new Error('ARTICLE_ACCESS_PEPPER 必须至少 32 个字符');
    }

    const records = await FeishuBaseSyncService.fetchAllRecords(config.feishu.tables.articleAccessCodes);
    const seenRecordIds: string[] = [];
    let imported = 0;
    let updated = 0;

    for (const record of records) {
      const recordId = record.record_id || '';
      const fields = record.fields || {};
      if (!recordId) continue;
      seenRecordIds.push(recordId);

      const postId = FeishuBaseSyncService.textValue(fields.PostID || fields.PostId);
      const requestedStatus = FeishuBaseSyncService.textValue(fields.Status).toLocaleLowerCase();
      const existing = await prisma.articleAccessCode.findUnique({ where: { feishuRecordId: recordId } });

      if (requestedStatus === 'revoked' || requestedStatus === '已撤销') {
        if (existing) {
          await prisma.$transaction([
            prisma.articleAccessGrant.deleteMany({ where: { codeId: existing.id } }),
            prisma.articleAccessCode.update({ where: { id: existing.id }, data: { status: 'revoked' } }),
          ]);
          updated += 1;
        }
        continue;
      }

      if (existing?.status === 'used' || existing?.status === 'revoked') {
        // A consumed Feishu row can never be reset. Administrators must create
        // a new row, which also makes the audit trail unambiguous.
        continue;
      }

      const password = normalizeArticlePassword(fields.PasswordInput);
      const expiresAt = FeishuBaseSyncService.dateValue(fields.ExpiresAt);
      const bindIp = checkboxValue(fields.BindIP);
      const grantHours = positiveGrantHours(fields.GrantHours);

      if (existing && !password) {
        const status = expiresAt && expiresAt.getTime() <= Date.now() ? 'expired' : 'active';
        await prisma.articleAccessCode.update({
          where: { id: existing.id },
          data: { postId: postId || existing.postId, bindIp, grantHours, expiresAt, status },
        });
        updated += 1;
        continue;
      }

      const passwordError = validateArticlePassword(password);
      if (!SAFE_POST_ID.test(postId) || passwordError || !password) {
        await writeFeishuStatus(recordId, {
          Status: 'Error',
          SyncMessage: !SAFE_POST_ID.test(postId) ? 'PostID 格式无效' : passwordError || '请填写 PasswordInput',
        });
        continue;
      }

      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        await writeFeishuStatus(recordId, {
          PasswordInput: '',
          Status: 'Expired',
          SyncMessage: '密码过期时间早于当前时间',
        });
        continue;
      }

      const codeDigest = articleCodeDigest(
        config.articleAccess.pepper,
        config.feishu.dataEnvironment,
        password,
      );
      const duplicate = await prisma.articleAccessCode.findFirst({
        where: {
          environment: config.feishu.dataEnvironment,
          codeDigest,
          NOT: { feishuRecordId: recordId },
        },
      });
      if (duplicate) {
        await writeFeishuStatus(recordId, {
          PasswordInput: '',
          Status: 'Error',
          SyncMessage: '该一次性密码已经存在，请生成新密码',
        });
        continue;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const codeHint = password.slice(-4);
      await prisma.articleAccessCode.upsert({
        where: { feishuRecordId: recordId },
        update: {
          postId,
          codeDigest,
          passwordHash,
          codeHint,
          bindIp,
          grantHours,
          expiresAt,
          status: 'active',
        },
        create: {
          feishuRecordId: recordId,
          environment: config.feishu.dataEnvironment,
          postId,
          codeDigest,
          passwordHash,
          codeHint,
          bindIp,
          grantHours,
          expiresAt,
          status: 'active',
        },
      });
      existing ? updated += 1 : imported += 1;

      // Feishu is an administrator inbox, never a password vault.
      await writeFeishuStatus(recordId, {
        PasswordInput: '',
        Status: 'Active',
        CodeHint: codeHint,
        SyncMessage: '已加密导入，明文已擦除',
      });
    }

    const missing = await prisma.articleAccessCode.findMany({
      where: {
        environment: config.feishu.dataEnvironment,
        status: 'active',
        ...(seenRecordIds.length > 0 ? { feishuRecordId: { notIn: seenRecordIds } } : {}),
      },
      select: { id: true },
    });
    // fetchAllRecords throws on an API failure. Therefore an empty successful
    // result really means the administrator removed every row, and all local
    // active codes must be revoked rather than remaining usable indefinitely.
    if (missing.length > 0) {
      const ids = missing.map(item => item.id);
      await prisma.$transaction([
        prisma.articleAccessGrant.deleteMany({ where: { codeId: { in: ids } } }),
        prisma.articleAccessCode.updateMany({ where: { id: { in: ids } }, data: { status: 'revoked' } }),
      ]);
    }

    return { imported, updated, revoked: missing.length, skipped: false };
  }

  public static async reportUsed(recordId: string, usedAt: Date, ip: string): Promise<void> {
    try {
      await writeFeishuStatus(recordId, {
        Status: 'Used',
        UsedAt: usedAt.getTime(),
        UsedIP: maskIpForAudit(ip),
        SyncMessage: '一次性密码已核销',
      });
    } catch (error) {
      // The database remains authoritative. A later reconciliation can repair
      // Feishu without making an already consumed code usable again.
      console.error('[ArticleAccess] 回写飞书核销状态失败:', error);
    }
  }
}
