import { config } from '../config';
import { prisma } from '../core/Database';
import { cardCodeDigest, normalizeCardCode, validateCardCode } from '../utils/CardRedeem';

/**
 * 单卡售后工具：查询 / 重置下载 / 撤销。
 * 面向管理员客服场景——买家丢文件、换网络导致下载窗口过期、退款需要作废等。
 * 本地数据库是权威状态；飞书台账为可选登记，这里不回写（保持与发卡通道一致的降级语义）。
 */
export type CardSupportView = {
  cardId: number;
  codeHint: string;
  productName: string;
  fileName: string | null;
  status: string;
  source: string;
  expiresAt: string | null;
  usedAt: string | null;
  replayExpiresAt: string | null;
  issueBatchId: number | null;
  createdAt: string;
};

export type CardSupportResult =
  | { success: true; card: CardSupportView }
  | { success: false; status: number; message: string };

export class CardSupportService {
  private static assertReady(): void {
    if (!config.cardRedeem.enabled) throw new Error('卡密提取功能未开启');
    if (config.cardRedeem.secret.length < 32) throw new Error('CARD_REDEEM_SECRET 配置无效');
    if (config.cardRedeem.previousSecrets.some(secret => secret.length < 32)) {
      throw new Error('CARD_REDEEM_PREVIOUS_SECRETS 配置无效');
    }
  }

  private static async findByCode(codeInput: unknown) {
    const code = normalizeCardCode(codeInput);
    if (validateCardCode(code)) return null;
    const environment = config.feishu.dataEnvironment;
    for (const secret of [config.cardRedeem.secret, ...config.cardRedeem.previousSecrets]) {
      const digest = cardCodeDigest(secret, environment, code);
      const card = await prisma.cardCode.findUnique({
        where: { environment_codeDigest: { environment, codeDigest: digest } },
      });
      if (card) return card;
    }
    return null;
  }

  private static toView(card: {
    id: number;
    codeHint: string;
    productName: string;
    fileName: string | null;
    status: string;
    source: string;
    expiresAt: Date | null;
    usedAt: Date | null;
    replayExpiresAt: Date | null;
    issueBatchId: number | null;
    createdAt: Date;
  }): CardSupportView {
    return {
      cardId: card.id,
      codeHint: card.codeHint,
      productName: card.productName,
      fileName: card.fileName,
      status: card.status,
      source: card.source,
      expiresAt: card.expiresAt?.toISOString() ?? null,
      usedAt: card.usedAt?.toISOString() ?? null,
      replayExpiresAt: card.replayExpiresAt?.toISOString() ?? null,
      issueBatchId: card.issueBatchId,
      createdAt: card.createdAt.toISOString(),
    };
  }

  public static async lookup(codeInput: unknown): Promise<CardSupportResult> {
    CardSupportService.assertReady();
    const card = await CardSupportService.findByCode(codeInput);
    if (!card) return { success: false, status: 404, message: '卡密不存在' };
    return { success: true, card: CardSupportService.toView(card) };
  }

  /**
   * 重置已使用的卡密回可兑换状态：买家丢文件 / 换网络错过下载窗口时的补发手段。
   * 仅 status='used' 可重置；条件更新保证与并发兑换互不覆盖。
   */
  public static async reset(codeInput: unknown): Promise<CardSupportResult> {
    CardSupportService.assertReady();
    const card = await CardSupportService.findByCode(codeInput);
    if (!card) return { success: false, status: 404, message: '卡密不存在' };
    if (card.status !== 'used') {
      return { success: false, status: 409, message: `当前状态为 ${card.status}，只有已使用的卡密可以重置` };
    }
    const updated = await prisma.cardCode.updateMany({
      where: { id: card.id, status: 'used' },
      data: {
        status: 'active',
        usedAt: null,
        usedIpHash: null,
        replayTokenHash: null,
        replayExpiresAt: null,
        downloadGrantId: null,
        downloadGrantIssuedAt: null,
        downloadGrantExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      return { success: false, status: 409, message: '卡密状态已变化，请刷新后重试' };
    }
    console.log(`[CardSupport] 卡密已重置为可兑换: cardId=${card.id} hint=****${card.codeHint}`);
    const fresh = await prisma.cardCode.findUniqueOrThrow({ where: { id: card.id } });
    return { success: true, card: CardSupportService.toView(fresh) };
  }

  /**
   * 撤销单张卡密（退款 / 风控）。active 可直接撤销；used 撤销后同时失去重放下载资格。
   */
  public static async revoke(codeInput: unknown, reasonInput?: unknown): Promise<CardSupportResult> {
    CardSupportService.assertReady();
    const card = await CardSupportService.findByCode(codeInput);
    if (!card) return { success: false, status: 404, message: '卡密不存在' };
    if (card.status !== 'active' && card.status !== 'used') {
      return { success: false, status: 409, message: `当前状态为 ${card.status}，无需撤销` };
    }
    const updated = await prisma.cardCode.updateMany({
      where: { id: card.id, status: { in: ['active', 'used'] } },
      data: { status: 'revoked' },
    });
    if (updated.count !== 1) {
      return { success: false, status: 409, message: '卡密状态已变化，请刷新后重试' };
    }
    const reason = typeof reasonInput === 'string' ? reasonInput.trim().slice(0, 200) : '';
    console.log(`[CardSupport] 卡密已撤销: cardId=${card.id} hint=****${card.codeHint} reason=${reason || '未填写'}`);
    const fresh = await prisma.cardCode.findUniqueOrThrow({ where: { id: card.id } });
    return { success: true, card: CardSupportService.toView(fresh) };
  }
}
