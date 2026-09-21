import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../../config';
import { feishuClient } from '../../core/FeishuClient';
import { prisma } from '../../core/Database';
import {
  filterFeishuRecordsForCurrentEnvironment,
  shouldBackfillCurrentFeishuEnvironment,
  withCurrentFeishuEnvironment,
} from '../../utils/FeishuEnvironment';
import {
  FeishuUserRecord,
  feishuUserRecordFreshness,
  normalizeFeishuUserEmail,
  readFeishuText,
  selectLatestFeishuUserRecords,
} from '../../utils/FeishuUserRecords';

type FeishuUserSnapshot = {
  id: number;
  username: string;
  email: string;
  avatar?: string | null;
  isActive?: boolean;
};

export class FeishuIdentitySyncService {
private static userUpsertChain: Promise<void> = Promise.resolve();

private static async listCurrentEnvironmentUsers(): Promise<FeishuUserRecord[]> {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.users) return [];
    const records: FeishuUserRecord[] = [];
    let pageToken: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const response = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.users,
        },
        params: { page_size: 500, page_token: pageToken },
      });
      if (typeof response.code === 'number' && response.code !== 0) {
        throw new Error(`飞书用户列表返回错误码 ${response.code}`);
      }
      records.push(...((response.data?.items || []) as FeishuUserRecord[]));
      hasMore = response.data?.has_more === true;
      pageToken = response.data?.page_token;
      if (hasMore && !pageToken) throw new Error('飞书用户列表分页响应缺少 page_token');
    }
    return filterFeishuRecordsForCurrentEnvironment(records);
  }

public static queueUserUpsertToFeishu(user: FeishuUserSnapshot, provider: string): Promise<void> {
    // 强制串行执行，等待上一个任务（包括查询和写入）彻底完成
    const task = this.userUpsertChain.then(() => this.upsertUserToFeishu(user, provider));
    this.userUpsertChain = task.catch((err) => {
      console.error("[Users] 同步队列任务失败:", err);
      return undefined;
    });
    return task;
  }

private static async upsertUserToFeishu(user: FeishuUserSnapshot, provider: string): Promise<void> {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.users) return;

    // 强制增加短暂延迟，防止飞书 Bitable 数据索引存在毫秒级延迟（写后立刻读读不到最新数据）
    await new Promise(resolve => setTimeout(resolve, 500));

    const normalizedEmail = user.email.trim().toLowerCase();
    const currentRecords = await this.listCurrentEnvironmentUsers();
    const matchingRecords = currentRecords.filter(record => (
      normalizeFeishuUserEmail(record.fields) === normalizedEmail
      || readFeishuText(record.fields?.Id) === String(user.id)
    ));
    matchingRecords.sort((left, right) => feishuUserRecordFreshness(right) - feishuUserRecordFreshness(left));

    const fields = withCurrentFeishuEnvironment({
      Id: String(user.id),
      Username: user.username,
      Email: normalizedEmail,
      Avatar: { link: user.avatar || '', text: 'avatar' },
      Provider: provider,
      Role: 'user',
      Status: user.isActive === false ? 'inactive' : 'active',
      LastLogin: Date.now(),
    });
    const canonical = matchingRecords[0];

    if (canonical?.record_id) {
      await feishuClient.bitable.appTableRecord.update({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.users,
          record_id: canonical.record_id,
        },
        data: { fields },
      });
    } else {
      await feishuClient.bitable.appTableRecord.create({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.users,
        },
        data: { fields },
      });
    }

    const duplicateRecordIds = matchingRecords.slice(1)
      .map(record => record.record_id)
      .filter((recordId): recordId is string => Boolean(recordId));
    for (const recordId of duplicateRecordIds) {
      await feishuClient.bitable.appTableRecord.delete({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.users,
          record_id: recordId,
        },
      });
    }
    console.log(`[Users] 已保存 ${normalizedEmail} 的最新状态${duplicateRecordIds.length ? `，并清理 ${duplicateRecordIds.length} 条旧记录` : ''}。`);
  }

public static async syncAdminsToLocal() {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.admins || config.feishu.tables.admins === "在这里填入管理员表的_Table_ID") return;
    try {
      const res = await feishuClient.bitable.appTableRecord.list({
        path: {
          app_token: config.feishu.baseToken,
          table_id: config.feishu.tables.admins,
        },
        params: { page_size: 100 },
      });

      if (res.data && res.data.items) {
        for (const record of filterFeishuRecordsForCurrentEnvironment(res.data.items)) {
          const fields = record.fields;

          let username = '';
          if (fields.Username && Array.isArray(fields.Username)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            username = fields.Username.map((item: any) => item.text).join('');
          } else if (typeof fields.Username === 'string') {
            username = fields.Username;
          }

          let setPassword = '';
          if (fields['Set Password'] && Array.isArray(fields['Set Password'])) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setPassword = fields['Set Password'].map((item: any) => item.text).join('');
          } else if (typeof fields['Set Password'] === 'string') {
            setPassword = fields['Set Password'];
          }

          const isActive = fields.Active === true;

          if (!username) continue;

          let localAdmin = await prisma.admin.findUnique({ where: { username } });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (localAdmin && (localAdmin as any).isActive !== isActive) {
            localAdmin = await prisma.admin.update({
              where: { id: localAdmin.id },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data: { isActive } as any
            });
            console.log(`[Security] 已将管理员 ${username} 的激活状态更新为: ${isActive ? '启用' : '封禁'}`);
          }

          if (!isActive) {
            continue;
          }

          if (setPassword) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(setPassword, salt);

            if (localAdmin) {
              localAdmin = await prisma.admin.update({
                where: { id: localAdmin.id },
                data: { password: hashedPassword }
              });
            } else {
              localAdmin = await prisma.admin.create({
                data: {
                  username,
                  password: hashedPassword,
                  isTotpSetup: false
                }
              });
            }

            await feishuClient.bitable.appTableRecord.update({
              path: {
                app_token: config.feishu.baseToken,
                table_id: config.feishu.tables.admins,
                record_id: record.record_id as string,
              },
              data: {
                fields: withCurrentFeishuEnvironment({
                  'Set Password': ''
                })
              }
            });
            console.log(`[Security] 已将管理员 ${username} 的新密码同步至本地，并安全擦除飞书中的记录。`);
          } else if (!localAdmin) {
            const randomPass = crypto.randomBytes(32).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(randomPass, salt);

            localAdmin = await prisma.admin.create({
              data: {
                username,
                password: hashedPassword,
                isTotpSetup: false
              }
            });
            console.log(`[Security] 从飞书发现新管理员 ${username}，已在本地初始化占位。`);
          }
        }
      }
    } catch (error) {
      console.error("[Sync] 从飞书同步管理员配置失败:", error);
      throw error;
    }
  }

public static async syncUsersFromFeishuToLocal() {
    if (!feishuClient || !config.feishu.baseToken || !config.feishu.tables.users) return;
    try {
      const currentRecords = await this.listCurrentEnvironmentUsers();
      const latestUsers = selectLatestFeishuUserRecords(currentRecords);
      let duplicatesRemoved = 0;
      let environmentsBackfilled = 0;

      for (const { email, canonical, duplicates } of latestUsers) {
        const fields = canonical.fields || {};
        const username = readFeishuText(fields.Username);
        const status = readFeishuText(fields.Status).toLowerCase();
        const activeValue = readFeishuText(fields.Active).toLowerCase();
        const isActive = status
          ? status === 'active'
          : !['false', 'inactive', 'disabled', '0'].includes(activeValue);

        const existingUser = await prisma.user.findUnique({ where: { email } });
        const finalUsername = username || existingUser?.username || `${email.split('@')[0]}_${Math.floor(Math.random() * 1000)}`;
        await prisma.user.upsert({
          where: { email },
          update: { isActive, username: finalUsername },
          create: {
            email,
            username: finalUsername,
            avatar: '/avatars/default.svg',
            avatarDark: '/avatars/default.svg',
            isActive,
          },
        });

        if (canonical.record_id && shouldBackfillCurrentFeishuEnvironment(fields)) {
          await feishuClient.bitable.appTableRecord.update({
            path: {
              app_token: config.feishu.baseToken,
              table_id: config.feishu.tables.users,
              record_id: canonical.record_id,
            },
            data: { fields: withCurrentFeishuEnvironment({}) },
          });
          environmentsBackfilled += 1;
        }

        for (const duplicate of duplicates) {
          if (!duplicate.record_id) continue;
          await feishuClient.bitable.appTableRecord.delete({
            path: {
              app_token: config.feishu.baseToken,
              table_id: config.feishu.tables.users,
              record_id: duplicate.record_id,
            },
          });
          duplicatesRemoved += 1;
        }
      }
      console.log(`[Users] 用户同步完成：保留 ${latestUsers.length} 个最新状态，清理 ${duplicatesRemoved} 条重复记录，补标 ${environmentsBackfilled} 条环境记录。`);
      // 该集合是控制台“用户管理”唯一允许展示的本次飞书快照；本地历史账号
      // 仍可供业务鉴权使用，但不能再混入飞书管理视图。
      return {
        retained: latestUsers.length,
        duplicatesRemoved,
        environmentsBackfilled,
        emails: latestUsers.map(({ email }) => email),
        // 登录方式以飞书用户表的最新记录为准，不在本地 User 表重复保存，
        // 避免旧登录方式覆盖最近一次认证来源。
        providers: Object.fromEntries(latestUsers.map(({ email, canonical }) => [
          email,
          readFeishuText(canonical.fields?.Provider).trim().toLowerCase(),
        ])),
      };
    } catch (error) {
      console.error("[Sync] 从飞书同步用户列表失败:", error);
      throw error;
    }
  }
}
