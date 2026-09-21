import { cacheService } from './CacheService';
import { prisma } from '../core/Database';
import { FeishuCardCodeSyncService } from './feishu-sync/FeishuCardCodeSyncService';
import { deleteAlbumImages } from '../utils/AlbumImageStorage';
import { config } from '../config';

export class GCService {
  public static async performGC() {
    console.log('[GCService] 开始执行无效缓存清理...');
    const startTime = Date.now();
    let cleanedTokens = 0;
    let cleanedAlbumPhotos = 0;
    let cleanedArticleSessions = 0;
    let expiredArticleCodes = 0;
    let expiredCardCodes = 0;

    try {
      // 1. 清理过期的 MagicToken (15分钟过期)
      // Prisma 可能没有直接比较时间的优雅方式，如果是纯 string 存的时间或者 timestamp，我们可以计算
      // 假设 MagicToken 生成后 15 分钟失效
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const res = await prisma.magicToken.deleteMany({
        where: {
          createdAt: {
            lt: fifteenMinsAgo
          }
        }
      });
      cleanedTokens = res.count;
      console.log(`[GCService] 清理过期 MagicToken: ${cleanedTokens} 个`);

      // 2. 清理已从飞书删除或隐藏超过 7 天的相册文件。先删文件，成功后再删数据库记录。
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const expiredAlbumPhotos = await prisma.albumPhoto.findMany({
        where: {
          deletedAt: { lt: sevenDaysAgo },
          status: { in: ['Deleted', 'Hidden'] },
        },
        select: { id: true, displayFileName: true, thumbnailFileName: true },
        orderBy: { deletedAt: 'asc' },
        take: 100,
      });
      for (const photo of expiredAlbumPhotos) {
        await deleteAlbumImages(photo.displayFileName, photo.thumbnailFileName);
        await prisma.albumPhoto.delete({ where: { id: photo.id } });
        cleanedAlbumPhotos += 1;
      }
      console.log(`[GCService] 清理过期相册文件: ${cleanedAlbumPhotos} 组`);

      // 3. 删除过期匿名文章会话（关联授权通过级联删除），并将过期密码标记为 expired。
      // 已核销密码本身保留，作为一次性密码审计记录。
      const now = new Date();
      const expiredCodesResult = await prisma.articleAccessCode.updateMany({
        where: {
          status: 'active',
          expiresAt: { lte: now },
        },
        data: { status: 'expired' },
      });
      expiredArticleCodes = expiredCodesResult.count;
      const expiredSessionsResult = await prisma.anonymousAccessSession.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      cleanedArticleSessions = expiredSessionsResult.count;
      console.log(`[GCService] 清理过期文章访问会话: ${cleanedArticleSessions} 个；标记过期密码: ${expiredArticleCodes} 个`);

      // 先查出要过期的已关联卡密，标记后把 Expired 状态回写飞书台账。
      const expiringLinkedCards = await prisma.cardCode.findMany({
        where: { status: 'active', expiresAt: { lte: now }, feishuRecordId: { not: null } },
        select: { feishuRecordId: true },
      });
      const expiredCardCodesResult = await prisma.cardCode.updateMany({
        where: { status: 'active', expiresAt: { lte: now } },
        data: { status: 'expired' },
      });
      expiredCardCodes = expiredCardCodesResult.count;
      await prisma.cardCode.updateMany({
        where: {
          status: 'used',
          replayExpiresAt: { lte: now },
          replayTokenHash: { not: null },
        },
        data: { replayTokenHash: null, replayExpiresAt: null },
      });
      await prisma.cardIssueBatch.updateMany({
        where: {
          codesCiphertext: { not: null },
          createdAt: { lte: new Date(now.getTime() - config.cardRedeem.issueReplayHours * 60 * 60 * 1000) },
        },
        data: { codesCiphertext: null },
      });
      console.log(`[GCService] 标记过期卡密: ${expiredCardCodes} 个`);
      for (const card of expiringLinkedCards) {
        try {
          await FeishuCardCodeSyncService.reportExpiredToFeishu(card.feishuRecordId as string);
        } catch (error) {
          console.error('[GCService] 过期状态回写飞书失败:', error);
        }
      }

      // 4. 清理内存缓存 (这里只是简单打印或者按需重置某些长时无用缓存)
      // 如果有些缓存超过 24 小时未命中，可以释放，但目前基于 TTL 已经有一定保护。
      // 可以强制清理一下 RateLimit 的内存占用 (如果使用的是 memory store)

      // 5. 强制 Node.js 垃圾回收 (如果启动时带有 --expose-gc)
      if (global.gc) {
        global.gc();
        console.log('[GCService] 触发 V8 强制垃圾回收');
      }

      const elapsed = Date.now() - startTime;
      console.log(`[GCService] 清理完成，耗时 ${elapsed}ms`);

    } catch (error) {
      console.error('[GCService] 清理失败:', error);
    }
  }
}
