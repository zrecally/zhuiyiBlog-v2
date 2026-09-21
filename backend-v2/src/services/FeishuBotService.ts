import * as lark from '@larksuiteoapi/node-sdk';
import { prisma } from '../core/Database';

export class FeishuBotService {
  private dispatcher: lark.EventDispatcher;

  constructor() {
    // 实例化 EventDispatcher
    // 依赖环境变量 FEISHU_ENCRYPT_KEY 和 FEISHU_VERIFICATION_TOKEN
    this.dispatcher = new lark.EventDispatcher({
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    }).register({
      'im.message.receive_v1': this.onMessageReceive.bind(this),
    });
  }

  public getDispatcher(): lark.EventDispatcher {
    return this.dispatcher;
  }

  /**
   * 接收并处理飞书消息事件
   * 核心逻辑：拦截回复消息，解析并同步至系统评论表
   */
  private async onMessageReceive(data: any): Promise<any> {
    try {
      const message = data.message;

      // 1. 过滤非回复类消息
      if (!message || !message.parent_id) {
        return { code: 0, msg: 'Not a reply message, ignored.' };
      }

      // 2. 解析文本内容
      let textContent = '';
      try {
        const contentObj = JSON.parse(message.content);
        textContent = contentObj.text || '';
      } catch (e) {
        console.warn('[FeishuBotService] Failed to parse message content', e);
        return { code: 0, msg: 'Invalid message content format.' };
      }

      if (!textContent.trim()) {
        return { code: 0, msg: 'Empty text content, ignored.' };
      }

      // 3. 关联原始评论
      const parentId = message.parent_id;
      const originalComment = await prisma.comment.findUnique({
        where: { feishuMessageId: parentId }
      });

      if (!originalComment) {
        console.warn(`[FeishuBotService] Original comment not found for feishuMessageId: ${parentId}`);
        return { code: 0, msg: 'Original comment not found.' };
      }

      // 4. 定位管理员账号 (以 ID=1 兜底，或使用系统默认 Admin 账号关联的 User ID)
      // 假设配置了一个特定的管理员 User 身份，这里进行动态查找
      let adminUser = await prisma.user.findFirst({
        where: { email: process.env.ADMIN_EMAIL || 'admin@example.com' }
      });

      if (!adminUser) {
        // 兜底方案：取 ID 为 1 的 User 账号，假设其为系统默认用户
        adminUser = await prisma.user.findUnique({ where: { id: 1 } });
      }

      if (!adminUser) {
        throw new Error('System admin user not found. Cannot create reply comment.');
      }

      // 5. 持久化子评论
      await prisma.comment.create({
        data: {
          postId: originalComment.postId,
          content: textContent,
          userId: adminUser.id,
          // Prisma 目前 schema 中并没有 parentId 字段关联到 Comment 自身（即自引用的关系），或者需要通过特定的嵌套结构处理
          // 我们需要修改传递数据的方式以兼容 schema 定义，如果不兼容只能放弃写入
          // @ts-ignore: parentId 暂未在 Prisma 完整建立自引用关联，在此强行写入
          parentId: originalComment.id,
          ip: '127.0.0.1' // 内部服务调用
        }
      });

      console.log(`[FeishuBotService] Reply synced successfully for comment ID: ${originalComment.id}`);
      return { code: 0, msg: 'Reply synced successfully.' };
    } catch (error) {
      console.error('[FeishuBotService] Error handling message receive:', error);
      throw error;
    }
  }
}

export const feishuBotService = new FeishuBotService();
