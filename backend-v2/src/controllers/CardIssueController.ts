import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { config } from '../config';
import { feishuClient } from '../core/FeishuClient';
import { prisma } from '../core/Database';
import { Prisma } from '@prisma/client';
import { cardOssHead, cardOssList, cardOssReady } from '../core/CardOssClient';
import { cardFileMediaType, isSafeOssKey, sanitizeCardFileName } from '../utils/CardFileStorage';
import {
  cardCodeDigest,
  cardIssueRequestFingerprint,
  decryptCardIssueCodes,
  encryptCardIssueCodes,
  validateRedeemRequestId,
} from '../utils/CardRedeem';
import { maskIpForAudit } from '../utils/ArticleAccess';
import { generateCardCodes } from '../utils/CardCodeRule';
import { CardSupportService } from '../services/CardSupportService';
import { auditTrail } from '../utils/AuditTrail';

/**
 * 可视化发卡工作台后端：本地直发 + 飞书台账。
 *  - 文件只留在私有对象存储桶，不经过飞书（无附件上传）；
 *  - 批量生成卡密后直接落库绑定桶内对象；
 *  - 同时把卡密登记到飞书 CardCodes 作为管理台账，由同步服务对账关联
 *    （回填 feishuRecordId、清空明文、核销后回写 Used 状态）。
 * 卡密明文只在本次响应与飞书台账中出现，数据库只保留哈希与末 4 位提示。
 */
export class CardIssueController {
  private static assertReady(): void {
    if (!config.cardRedeem.enabled) throw new Error('卡密提取功能未开启');
    if (config.cardRedeem.secret.length < 32) throw new Error('CARD_REDEEM_SECRET 配置无效');
    if (config.cardRedeem.previousSecrets.some(secret => secret.length < 32)) {
      throw new Error('CARD_REDEEM_PREVIOUS_SECRETS 配置无效');
    }
    if (!cardOssReady()) throw new Error('未启用卡密对象存储（CARD_REDEEM_OSS_ENABLED）');
  }

  public static async getPools(req: Request, res: Response) {
    try {
      CardIssueController.assertReady();
      const objects = await cardOssList();
      const boundCounts = await prisma.cardCode.groupBy({
        by: ['fileKey'],
        _count: { fileKey: true },
        where: { environment: config.feishu.dataEnvironment },
      });
      const boundMap = new Map(boundCounts.map(item => [item.fileKey, item._count.fileKey]));
      const objectsWithRef = objects.map(o => ({ ...o, referencedBy: boundMap.get(o.key) || 0 }));
      // 卡密流水游标分页：cardsCursor 为上一页最后一条的 id（倒序取其后更旧的一页）。
      // 不传 cursor 即首页；单页上限 200，默认 50。新增字段对旧客户端向后兼容。
      const cardsLimitRaw = Number(req.query.cardsLimit);
      const cardsLimit = Number.isSafeInteger(cardsLimitRaw) && cardsLimitRaw >= 1 && cardsLimitRaw <= 200
        ? cardsLimitRaw
        : 50;
      const cardsCursorRaw = Number(req.query.cardsCursor);
      const cardsCursor = Number.isSafeInteger(cardsCursorRaw) && cardsCursorRaw > 0 ? cardsCursorRaw : null;
      // 可选状态筛选（active/used/revoked）：与前端标签页联动，筛选也作用于分页与 total
      const cardsStatusRaw = typeof req.query.cardsStatus === 'string' ? req.query.cardsStatus : '';
      const cardsStatus = ['active', 'used', 'revoked'].includes(cardsStatusRaw) ? cardsStatusRaw : null;
      const cardsEnvFilter = {
        environment: config.feishu.dataEnvironment,
        ...(cardsStatus ? { status: cardsStatus } : {}),
      };
      const cardsWhere = {
        ...cardsEnvFilter,
        ...(cardsCursor ? { id: { lt: cardsCursor } } : {}),
      };
      // 多取一条用于判断是否还有下一页，避免再发一次 count 深分页查询。
      const [cardPage, cardsTotal, statusGroups] = await Promise.all([
        prisma.cardCode.findMany({
          where: cardsWhere,
          select: {
            id: true,
            codeHint: true,
            status: true,
            productName: true,
            fileName: true,
            expiresAt: true,
            usedAt: true,
            createdAt: true,
          },
          orderBy: { id: 'desc' },
          take: cardsLimit + 1,
        }),
        // total 与列表同筛选（状态页显示该状态真实总数）；状态计数表恒为全量
        prisma.cardCode.count({ where: cardsEnvFilter }),
        prisma.cardCode.groupBy({
          by: ['status'],
          _count: { status: true },
          where: { environment: config.feishu.dataEnvironment },
        }),
      ]);
      const cardsHasMore = cardPage.length > cardsLimit;
      const recentCards = cardsHasMore ? cardPage.slice(0, cardsLimit) : cardPage;
      const lastCard = recentCards[recentCards.length - 1];
      const cardsStatusCounts: Record<string, number> = {};
      for (const group of statusGroups) {
        cardsStatusCounts[group.status] = group._count.status;
      }
      return res.json({
        success: true,
        objects: objectsWithRef,
        recentCards,
        cardsTotal,
        cardsStatusCounts,
        cardsHasMore,
        cardsNextCursor: cardsHasMore && lastCard ? lastCard.id : null,
      });
    } catch (error) {
      console.error('[CardIssue] 读取桶内对象失败:', error);
      return res.status(500).json({ success: false, message: '读取桶内对象失败' });
    }
  }

  public static async issue(req: Request, res: Response) {
    try {
      CardIssueController.assertReady();
      const ossKey = typeof req.body?.ossKey === 'string' ? req.body.ossKey.trim() : '';
      const requestedProductName = typeof req.body?.productName === 'string' ? req.body.productName.trim().slice(0, 120) : '';
      const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : '';
      const count = Number(req.body?.count);
      const expiresInDaysRaw = req.body?.expiresInDays;
      if (!ossKey) return res.status(400).json({ success: false, message: '请选择要绑定的文件' });
      if (!isSafeOssKey(ossKey)) return res.status(400).json({ success: false, message: '对象 key 不合法' });
      if (!validateRedeemRequestId(requestId)) {
        return res.status(400).json({ success: false, message: '发卡请求 ID 不合法' });
      }
      if (!Number.isSafeInteger(count) || count < 1 || count > 200) {
        return res.status(400).json({ success: false, message: '数量必须是 1-200 之间的整数' });
      }
      // 可选有效期（天）。不传视为永久有效，但对外销售建议必填。
      let expiresInDays: number | null = null;
      if (expiresInDaysRaw !== undefined && expiresInDaysRaw !== null && expiresInDaysRaw !== '') {
        expiresInDays = Number(expiresInDaysRaw);
        if (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
          return res.status(400).json({ success: false, message: '有效期必须是 1-3650 之间的整数天' });
        }
      }
      const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 3600 * 1000) : null;

      const environment = config.feishu.dataEnvironment;
      const fileName = sanitizeCardFileName(ossKey.split('/').pop() || ossKey);
      const productName = requestedProductName || fileName;
      const requestFingerprint = cardIssueRequestFingerprint(config.cardRedeem.secret, environment, {
        ossKey,
        productName,
        count,
        expiresInDays,
      });
      const acceptedFingerprints = [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets]
        .map(secret => cardIssueRequestFingerprint(secret, environment, {
          ossKey,
          productName,
          count,
          expiresInDays,
        }));

      const existing = await prisma.cardIssueBatch.findUnique({
        where: { environment_requestId: { environment, requestId } },
      });
      if (existing) {
        if (!acceptedFingerprints.includes(existing.requestFingerprint)) {
          return res.status(409).json({ success: false, message: '同一请求 ID 不能用于不同的发卡参数' });
        }
        if (!existing.codesCiphertext) {
          return res.status(409).json({ success: false, message: '该批次已经完成，但卡密回执保留期已结束，请勿重复发卡' });
        }
        const recovered = [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets]
          .map(secret => decryptCardIssueCodes(
            secret,
            existing.environment,
            existing.requestId,
            existing.codesCiphertext!,
          ))
          .find((codes): codes is string[] => Array.isArray(codes));
        if (!recovered) throw new Error('发卡批次回执损坏，禁止生成重复批次');
        return res.json({
          success: true,
          batchId: existing.id,
          replayed: true,
          bound: { key: existing.ossKey, size: existing.fileSize },
          issued: existing.cardCount,
          feishuRegistered: existing.feishuRegistered,
          feishuError: existing.feishuError,
          codes: recovered,
        });
      }

      const meta = await cardOssHead(ossKey);
      if (!Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > config.cardRedeem.maxFileBytes) {
        return res.status(400).json({
          success: false,
          message: `文件必须在 1-${config.cardRedeem.maxFileBytes} 字节之间`,
        });
      }
      const codes = generateCardCodes(count);
      const cardRows: Prisma.CardCodeCreateManyInput[] = [];
      for (let index = 0; index < codes.length; index += 1) {
        const item = codes[index];
        const codeDigest = cardCodeDigest(config.cardRedeem.secret, environment, item.code);
        const codeHash = await bcrypt.hash(item.code, 10);
        cardRows.push({
          environment,
          source: 'local-oss',
          productName,
          codeDigest,
          codeHash,
          codeHint: item.code.slice(-4),
          fileKey: ossKey,
          fileName,
          fileMediaType: cardFileMediaType(fileName),
          fileSize: meta.size,
          fileEtag: meta.etag,
          fileVersionId: meta.versionId,
          salesChannel: 'external-platform',
          status: 'active',
          expiresAt,
          issueIndex: index,
        });
      }

      const codesCiphertext = encryptCardIssueCodes(
        config.cardRedeem.secret,
        environment,
        requestId,
        codes.map(item => item.display),
      );
      let batch;
      try {
        batch = await prisma.$transaction(async tx => {
          const created = await tx.cardIssueBatch.create({
            data: {
              environment,
              requestId,
              requestFingerprint,
              ossKey,
              productName,
              fileName,
              fileSize: meta.size,
              cardCount: codes.length,
              codesCiphertext,
            },
          });
          await tx.cardCode.createMany({
            data: cardRows.map(row => ({ ...row, issueBatchId: created.id })),
          });
          return created;
        });
      } catch (error) {
        const concurrent = await prisma.cardIssueBatch.findUnique({
          where: { environment_requestId: { environment, requestId } },
        });
        if (!concurrent) throw error;
        if (!acceptedFingerprints.includes(concurrent.requestFingerprint) || !concurrent.codesCiphertext) {
          return res.status(409).json({ success: false, message: '发卡请求已经处理，参数或回执状态不一致' });
        }
        const recovered = [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets]
          .map(secret => decryptCardIssueCodes(
            secret,
            concurrent.environment,
            concurrent.requestId,
            concurrent.codesCiphertext!,
          ))
          .find((codes): codes is string[] => Array.isArray(codes));
        if (!recovered) throw error;
        return res.json({
          success: true,
          batchId: concurrent.id,
          replayed: true,
          bound: { key: concurrent.ossKey, size: concurrent.fileSize },
          issued: concurrent.cardCount,
          feishuRegistered: concurrent.feishuRegistered,
          feishuError: concurrent.feishuError,
          codes: recovered,
        });
      }

      // 登记到飞书 CardCodes 作为管理台账；登记失败不影响本地发卡结果。
      let feishuRegistered = 0;
      let feishuError: string | null = null;
      let feishuStatus = 'disabled';
      if (config.cardRedeem.feishuSyncEnabled && feishuClient && config.feishu.baseToken && config.feishu.tables.cardCodes) {
        try {
          const records = codes.map((item, index) => ({
            fields: {
              Name: `iss-${batch.id}-${index + 1}`,
              ProductName: productName,
              CodeInput: item.code,
              SalesChannel: 'external-platform',
              Environment: environment,
            },
          }));
          const response = await feishuClient.bitable.appTableRecord.batchCreate({
            path: { app_token: config.feishu.baseToken, table_id: config.feishu.tables.cardCodes },
            data: { records: records as any },
          });
          if (response.code && response.code !== 0) {
            throw new Error(`${response.code}: ${response.msg}`);
          }
          feishuRegistered = codes.length;
          feishuStatus = 'registered';
        } catch (error) {
          feishuError = error instanceof Error ? error.message : String(error);
          feishuStatus = 'failed';
          console.error('[CardIssue] 飞书台账登记失败:', feishuError);
        }
      } else {
        feishuError = config.cardRedeem.feishuSyncEnabled ? '飞书未配置' : null;
      }
      await prisma.cardIssueBatch.update({
        where: { id: batch.id },
        data: { feishuStatus, feishuRegistered, feishuError },
      }).catch(error => console.error('[CardIssue] 发卡批次台账状态保存失败:', error));

      auditTrail(req, 'CARD_ISSUE', `管理员批量发卡 ${codes.length} 张，绑定「${batch.productName}」，批次 #${batch.id}（明文卡密不落审计）`);

      return res.json({
        success: true,
        batchId: batch.id,
        replayed: false,
        bound: { key: ossKey, size: meta.size },
        issued: codes.length,
        feishuRegistered,
        feishuError,
        codes: codes.map(item => item.display),
      });
    } catch (error) {
      console.error('[CardIssue] 发卡失败:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : '发卡失败',
      });
    }
  }

  /** 交付授权统计：bytes 是事务预留的整文件字节，不冒充 OSS 实际下行流量。 */
  public static async getTraffic(_req: Request, res: Response) {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const [todayAgg, totalAgg, recent, recent14] = await Promise.all([
        prisma.cardDownloadLog.aggregate({
          where: { createdAt: { gte: startOfToday }, status: { in: ['link_issued', 'completed'] } },
          _count: { id: true },
          _sum: { bytes: true },
        }),
        prisma.cardDownloadLog.aggregate({
          where: { status: { in: ['link_issued', 'completed'] } },
          _count: { id: true },
          _sum: { bytes: true },
        }),
        prisma.cardDownloadLog.findMany({
          orderBy: { id: 'desc' },
          take: 30,
        }),
        prisma.cardDownloadLog.findMany({
          where: {
            createdAt: { gte: new Date(Date.now() - 13 * 24 * 3600 * 1000) },
            status: { in: ['link_issued', 'completed'] },
          },
          select: { createdAt: true, bytes: true, fileKey: true },
        }),
      ]);
      // 近 14 天逐日聚合（本地时区，缺数据日补零）
      const dayKey = (d: Date) => {
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
      };
      const dailyMap = new Map<string, { count: number; bytes: number }>();
      for (let i = 13; i >= 0; i -= 1) {
        const d = new Date(Date.now() - i * 24 * 3600 * 1000);
        dailyMap.set(dayKey(d), { count: 0, bytes: 0 });
      }
      for (const row of recent14) {
        const k = dayKey(row.createdAt);
        const bucket = dailyMap.get(k);
        if (bucket) {
          bucket.count += 1;
          bucket.bytes += row.bytes;
        }
      }
      const daily = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

      // 按文件聚合（Top 5，按字节降序）
      const fileMap = new Map<string, { count: number; bytes: number }>();
      for (const row of recent14) {
        const bucket = fileMap.get(row.fileKey) || { count: 0, bytes: 0 };
        bucket.count += 1;
        bucket.bytes += row.bytes;
        fileMap.set(row.fileKey, bucket);
      }
      const byFile = Array.from(fileMap.entries())
        .map(([fileKey, v]) => ({ fileKey, ...v }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5);

      return res.json({
        success: true,
        accountingMode: 'reserved_grant_bytes',
        daily,
        byFile,
        todayCount: todayAgg._count.id,
        todayBytes: todayAgg._sum.bytes || 0,
        totalCount: totalAgg._count.id,
        totalBytes: totalAgg._sum.bytes || 0,
        recent: recent.map(item => ({
          codeHint: item.codeHint,
          fileKey: item.fileKey,
          bytes: item.bytes,
          ipMasked: item.ipMasked,
          storage: item.storage,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error('[CardIssue] 读取流量统计失败:', error);
      return res.status(500).json({ success: false, message: '读取流量统计失败' });
    }
  }

  /** 单卡查询（管理端售后视图，只返回脱敏信息）。 */
  public static async lookupCard(req: Request, res: Response) {
    try {
      const result = await CardSupportService.lookup(req.query?.code);
      if (!result.success) return res.status(result.status).json({ success: false, message: result.message });
      return res.json({ success: true, card: result.card });
    } catch (error) {
      console.error('[CardIssue] 卡密查询失败:', error);
      return res.status(500).json({ success: false, message: error instanceof Error ? error.message : '查询失败' });
    }
  }

  /** 单卡重置：已使用的卡恢复可兑换（买家丢文件 / 错过下载窗口的补发手段）。 */
  public static async resetCard(req: Request, res: Response) {
    try {
      const result = await CardSupportService.reset(req.body?.code);
      if (!result.success) return res.status(result.status).json({ success: false, message: result.message });
      auditTrail(req, 'CARD_RESET', `管理员将卡密 ${result.card.codeHint} 重置为可兑换`);
      return res.json({ success: true, card: result.card, message: '已重置为可兑换状态' });
    } catch (error) {
      console.error('[CardIssue] 卡密重置失败:', error);
      return res.status(500).json({ success: false, message: error instanceof Error ? error.message : '重置失败' });
    }
  }

  /** 单卡撤销：退款 / 风控作废，撤销后无法再兑换或下载。 */
  public static async revokeCard(req: Request, res: Response) {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 80) : '';
      const result = await CardSupportService.revoke(req.body?.code, req.body?.reason);
      if (!result.success) return res.status(result.status).json({ success: false, message: result.message });
      auditTrail(req, 'CARD_REVOKE', `管理员撤销卡密 ${result.card.codeHint}${reason ? `，原因：${reason}` : ''}`);
      return res.json({ success: true, card: result.card, message: '已撤销' });
    } catch (error) {
      console.error('[CardIssue] 卡密撤销失败:', error);
      return res.status(500).json({ success: false, message: error instanceof Error ? error.message : '撤销失败' });
    }
  }
}
