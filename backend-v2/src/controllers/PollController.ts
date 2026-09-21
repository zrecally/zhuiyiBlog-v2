import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../core/Database';
import {
  aggregateProductPollResults,
  getProductPollDefinition,
  parseProductPollDefinition,
  PRODUCT_POLL_ID,
  saveProductPollDefinition,
  validateProductPollSelections,
} from '../services/PollService';

function voterKey(user: Express.User): string {
  return createHash('sha256')
    .update(`${config.jwtSecret}:${PRODUCT_POLL_ID}:${user.role}:${user.id}`)
    .digest('hex');
}

async function pollRows() {
  return prisma.pollVote.findMany({
    where: { pollId: PRODUCT_POLL_ID },
    select: { voterKey: true, selections: true },
    orderBy: { id: 'asc' },
  });
}

export class PollController {
  private static async checkIsHidden(res: Response): Promise<boolean> {
    const navLinksConfig = await prisma.systemConfig.findUnique({
      where: { key: 'navLinks' }
    });
    const navLinksStr = navLinksConfig?.value || '';
    const hiddenLinks = navLinksStr.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    if (hiddenLinks.some(link => ['产品投票', 'Roadmap', 'Vote', '投票'].includes(link))) {
      res.status(404).json({ success: false, message: '此功能已关闭或隐藏' });
      return true;
    }
    return false;
  }

  public static async getProductPoll(req: Request, res: Response) {
    if (await PollController.checkIsHidden(res)) return;
    try {
      const rows = await pollRows();
      const results = aggregateProductPollResults(rows);
      const definition = await getProductPollDefinition();
      const key = req.user ? voterKey(req.user) : null;
      const ownVote = key ? rows.find(row => row.voterKey === key) : null;
      const selections = ownVote
        ? validateProductPollSelections(ownVote.selections)
        : null;

      return res.json({
        success: true,
        data: {
          pollId: PRODUCT_POLL_ID,
          definition,
          totalVotes: results.totalVotes,
          hasVoted: Boolean(selections),
          selections,
          // 仅返回按候选项聚合后的票数，不包含投票人、IP 或单条选择。
          // 前端进度条需要在投票前就能展示公开的匿名统计，不能再以“是否
          // 已投票”作为返回统计结果的条件。
          results,
          requiresLogin: !req.user,
        },
      });
    } catch (error) {
      console.error('[Poll] 读取产品投票失败:', error);
      return res.status(500).json({ success: false, message: '读取投票状态失败' });
    }
  }

  public static async submitProductPoll(req: Request, res: Response) {
    if (await PollController.checkIsHidden(res)) return;
    const selections = validateProductPollSelections(req.body?.selections);
    if (!selections) {
      return res.status(400).json({ success: false, message: '投票选项不完整或无效' });
    }

    try {
      const definition = await getProductPollDefinition();
      if (!definition.enabled) {
        return res.status(403).json({ success: false, message: '当前投票未开放' });
      }
      await prisma.pollVote.create({
        data: {
          pollId: PRODUCT_POLL_ID,
          voterKey: voterKey(req.user!),
          selections,
        },
      });
      const results = aggregateProductPollResults(await pollRows());
      return res.status(201).json({
        success: true,
        message: '投票提交成功，感谢你的参与',
        data: { pollId: PRODUCT_POLL_ID, selections, results },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ success: false, message: '本期投票每位访客只能提交一次' });
      }
      console.error('[Poll] 写入产品投票失败:', error);
      return res.status(500).json({ success: false, message: '投票提交失败，请稍后再试' });
    }
  }

  public static async getProductPollAdmin(_req: Request, res: Response) {
    try {
      const definition = await getProductPollDefinition();
      const results = aggregateProductPollResults(await pollRows());
      return res.json({ success: true, data: { definition, results } });
    } catch (error) {
      console.error('[Poll] 读取投票管理配置失败:', error);
      return res.status(500).json({ success: false, message: '读取投票配置失败' });
    }
  }

  public static async updateProductPollAdmin(req: Request, res: Response) {
    const definition = parseProductPollDefinition(req.body?.definition);
    if (!definition) {
      return res.status(400).json({ success: false, message: '投票配置不完整或字段超出长度限制' });
    }

    try {
      await saveProductPollDefinition(definition);
      await prisma.auditLog.create({
        data: {
          ip: req.ip || 'unknown',
          action: 'POLL_CONFIG_UPDATED',
          details: `管理员更新产品投票配置，状态：${definition.enabled ? '开放' : '关闭'}`,
        },
      });
      return res.json({ success: true, message: '投票配置已保存', data: { definition } });
    } catch (error) {
      console.error('[Poll] 保存投票管理配置失败:', error);
      return res.status(500).json({ success: false, message: '保存投票配置失败' });
    }
  }
}
