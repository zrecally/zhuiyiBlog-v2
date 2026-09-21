import fs from 'node:fs';
import { config } from '../src/config';
import { feishuClient } from '../src/core/FeishuClient';
import { generateCardCode } from '../src/utils/CardCodeRule';

/**
 * 飞书发卡链路演示：向 CardFiles 传一个附件，向 CardCodes 写一条引用它的卡密记录，
 * 然后交给每 60 秒的同步服务完成绑定。用于端到端验证，不是正式发卡通道。
 * 用法: npx tsx scripts/demo-feishu-issue.ts <本地文件> <池名称> [产品名]
 */
const main = async () => {
  if (!feishuClient || !config.feishu.baseToken) throw new Error('需要飞书凭证与 FEISHU_BASE_TOKEN');
  const [localFile, poolName, productName] = process.argv.slice(2);
  if (!localFile || !poolName) throw new Error('用法: npx tsx scripts/demo-feishu-issue.ts <本地文件> <池名称> [产品名]');
  const cardFilesTableId = config.feishu.tables.cardFiles;
  const cardCodesTableId = config.feishu.tables.cardCodes;
  if (!cardFilesTableId || !cardCodesTableId) throw new Error('请先在 .env 配置两个卡密表 ID');

  const stat = fs.statSync(localFile);
  const upload = await feishuClient.drive.media.uploadAll({
    data: {
      file_name: localFile.split('/').pop() || 'file.bin',
      parent_type: 'bitable_file',
      parent_node: config.feishu.baseToken, // bitable 附件上传的 parent_node 是 Base 的 app_token
      size: stat.size,
      file: fs.createReadStream(localFile),
    },
  });
  const fileToken = upload?.file_token;
  if (!fileToken) throw new Error('附件上传失败');
  console.log(`[1] 附件已上传 file_token=${fileToken}`);

  await feishuClient.bitable.appTableRecord.create({
    path: { app_token: config.feishu.baseToken, table_id: cardFilesTableId },
    data: {
      fields: {
        Name: poolName,
        File: [{ file_token: fileToken }],
        Environment: config.feishu.dataEnvironment,
      } as any,
    },
  });
  console.log(`[2] CardFiles 记录已创建：Name=${poolName}`);

  const generated = generateCardCode();
  await feishuClient.bitable.appTableRecord.create({
    path: { app_token: config.feishu.baseToken, table_id: cardCodesTableId },
    data: {
      fields: {
        Name: `demo-${Date.now()}`,
        ProductName: productName || poolName,
        CodeInput: generated.code,
        FileRef: poolName,
        SalesChannel: 'feishu-demo',
        Environment: config.feishu.dataEnvironment,
      } as any,
    },
  });
  console.log(`[3] CardCodes 记录已创建，卡密=${generated.display}`);
  console.log('等待 60-90 秒同步后即可在 /card 提取。');
};

void main().catch(error => {
  console.error(`[FAILED] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
