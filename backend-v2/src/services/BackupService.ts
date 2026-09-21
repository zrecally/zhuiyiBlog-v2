import * as path from 'path';
import * as fs from 'fs';
import { writeDatabaseBackup } from '../database/DatabaseBackup';
import { config } from '../config';
import fetch from 'node-fetch';

export class BackupService {
  public static async performBackup() {
    let filePath = '';

    try {
      console.log('[BackupService] 正在执行数据库备份...');

      const backupDir = path.resolve(process.cwd(), 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      }

      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `mysql-backup-${dateStr}.portable.json.gz`;
      filePath = path.join(backupDir, filename);

      await writeDatabaseBackup(filePath);

      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`[BackupService] 备份成功: ${filename} (${sizeMB} MB)`);

      // 清理超过 7 天的旧备份
      this.cleanOldBackups(backupDir);

      // 发送飞书通知
      if (config.feishu.errorWebhookUrl) {
        this.notifyFeishu('✅ 数据库自动备份成功', `**文件：** ${filename}\n**大小：** ${sizeMB} MB\n**状态：** 本地逻辑备份完成；异地副本另行配置`);
      }

    } catch (error: any) {
      console.error('[BackupService] 备份失败:', error?.name?.startsWith('Prisma') ? (error.code || error.name) : error.message);
      if (config.feishu.errorWebhookUrl) {
        this.notifyFeishu('❌ 数据库自动备份失败', `**错误信息：**\n${error?.name?.startsWith('Prisma') ? '数据库备份失败，未输出记录或连接凭据' : error.message}`);
      }
    }
  }

  private static cleanOldBackups(backupDir: string) {
    const entries = fs.readdirSync(backupDir);
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (!/^mysql-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.portable\.json\.gz$/.test(entry)) continue;
      const entryPath = path.join(backupDir, entry);
      try {
        // Never delete unrelated directories, symlinks, or historic backups.
        const stats = fs.lstatSync(entryPath);
        if (now - stats.mtimeMs <= SEVEN_DAYS) continue;

        if (!stats.isFile()) continue;
        fs.unlinkSync(entryPath);
        console.log(`[BackupService] 已清理过期备份: ${entry}`);
      } catch (cleanupError) {
        // A cleanup failure must not mark an already completed database dump as
        // failed, or prevent subsequent scheduled backups from running.
        console.error(`[BackupService] 清理过期备份失败: ${entry}`, cleanupError);
      }
    }
  }

  private static notifyFeishu(title: string, content: string) {
    const card = {
      msg_type: "interactive",
      card: {
        header: {
          title: { content: title, tag: "plain_text" },
          template: title.includes('失败') ? "red" : "green"
        },
        elements: [
          { tag: "markdown", content: content }
        ]
      }
    };

    fetch(config.feishu.errorWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    }).catch(e => console.error('[BackupService] 发送通知失败:', e));
  }
}
