import nodemailer from 'nodemailer';
import { config } from '../config';

class MailClientManager {
  private transporter: nodemailer.Transporter;

  constructor() {
    if (!config.smtp.enabled) {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      console.log('[SMTP] Disabled by configuration.');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
      // SMTP protocol debug can include AUTH frames. Never write it to logs,
      // including in local/test environments where real credentials are used.
      logger: false,
      debug: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000
    });

    this.verify();
  }

  private verify() {
    this.transporter.verify((error) => {
      if (error) {
        console.log('SMTP 连接测试失败:', error);
      } else {
        console.log('SMTP 服务器连接成功，可以发送邮件了！');
      }
    });
  }

  public getTransporter() {
    return this.transporter;
  }
}

export const mailClientManager = new MailClientManager();
export const transporter = mailClientManager.getTransporter();
