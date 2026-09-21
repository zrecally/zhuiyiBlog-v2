import { feishuClient } from '../core/FeishuClient';

export class FeishuMarkdownParser {

  public static async fetchDocContent(docId: string, postId: string, isWiki: boolean): Promise<string | null> {
    if (!feishuClient) return null;

    let targetDocId = docId;
    if (isWiki) {
      try {
        const wikiRes = await feishuClient.request({
          method: 'GET',
          url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${docId}`
        });
        if (wikiRes && wikiRes.data && wikiRes.data.node && wikiRes.data.node.obj_token) {
          targetDocId = wikiRes.data.node.obj_token;
        } else {
          throw new Error("Wiki 节点信息解析失败");
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (wikiErr: any) {
        console.error(`❌ 解析飞书 Wiki 节点(${docId})失败:`, wikiErr.message || wikiErr);
        return null;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allBlocks: any[] = [];
    let hasMore = true;
    let pageToken: string | undefined = undefined;

    while (hasMore) {
      const res = await feishuClient.docx.documentBlock.list({
        path: { document_id: targetDocId },
        params: { page_size: 500, page_token: pageToken }
      });
      if (res.data && res.data.items) allBlocks = allBlocks.concat(res.data.items);
      hasMore = res.data ? (res.data.has_more || false) : false;
      pageToken = res.data ? res.data.page_token : undefined;
    }

    return await this.parseFeishuBlocksToMarkdown(allBlocks, postId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async parseFeishuBlocksToMarkdown(blocks: any[], postId: string): Promise<string> {
    let markdown = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blockMap: Record<string, any> = {};
    for (const b of blocks) {
        blockMap[b.block_id] = b;
    }

    const rootBlock = blocks[0];
    if (!rootBlock || rootBlock.block_type !== 1) return '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderElements = (elements: any[], isBlockLevel = false) => {
        if (!elements) return '';
        if (isBlockLevel && elements.length === 1 && elements[0].equation) {
            return `$$\n${elements[0].equation.content.trim()}\n$$`;
        }
        return elements.map(e => {
            if (e.equation) {
                return `$${e.equation.content.trim()}$`;
            }

            let content = e.text_run?.content || '';
            content = content.replace(/&lt;/g, '<')
                             .replace(/&gt;/g, '>')
                             .replace(/&#39;/g, "'")
                             .replace(/&apos;/g, "'")
                             .replace(/&quot;/g, '"');

            const isHtmlTag = /<[a-zA-Z0-9/]+>/.test(content);

            if (e.text_run?.text_element_style?.link) content = `[${content}](${e.text_run.text_element_style.link.url})`;

            if (e.text_run?.text_element_style?.inline_code) {
                content = `\`${content}\``;
            } else if (!isHtmlTag) {
                if (e.text_run?.text_element_style?.bold) content = `**${content}**`;
                if (e.text_run?.text_element_style?.italic) content = `*${content}*`;
                if (e.text_run?.text_element_style?.strikethrough) content = `~~${content}~~`;
                if (e.text_run?.text_element_style?.underline) content = `<u>${content}</u>`;
            } else {
                if (e.text_run?.text_element_style?.bold) content = `<strong>${content}</strong>`;
                if (e.text_run?.text_element_style?.italic) content = `<em>${content}</em>`;
                if (e.text_run?.text_element_style?.strikethrough) content = `<del>${content}</del>`;
                if (e.text_run?.text_element_style?.underline) content = `<u>${content}</u>`;
            }

            return content;
        }).join('');
    };

    const processBlock = async (blockId: string): Promise<string> => {
        const block = blockMap[blockId];
        if (!block) return '';

        let blockMarkdown = '';

        // 飞书原生表格由 table 块和多个 table_cell 子块组成。此前仅递归
        // 渲染了单元格内的段落，导致表格退化成一串普通文本，前端无法识别。
        if (block.table?.property) {
            const columnCount = Number(block.table.property.column_size) || 0;
            const cellIds = Array.isArray(block.table.cells) && block.table.cells.length > 0
                ? block.table.cells
                : (block.children || []);

            if (columnCount > 0 && cellIds.length > 0) {
                const cells = await Promise.all(cellIds.map(async (cellId: string) => {
                    const cell = blockMap[cellId];
                    const fragments = await Promise.all((cell?.children || []).map(processBlock));
                    return fragments
                        .join(' ')
                        .replace(/\n+/g, '<br/>')
                        .replace(/\|/g, '\\|')
                        .replace(/(<br\/?>\s*)+$/g, '')
                        .trim() || ' ';
                }));

                for (let index = 0; index < cells.length; index += columnCount) {
                    const row = cells.slice(index, index + columnCount);
                    while (row.length < columnCount) row.push(' ');
                    blockMarkdown += `| ${row.join(' | ')} |\n`;
                    if (index === 0) {
                        blockMarkdown += `| ${Array(columnCount).fill('---').join(' | ')} |\n`;
                    }
                }
                return `${blockMarkdown}\n`;
            }
        }

        // 表格已经由父 table 块统一输出，避免递归时将单元格正文重复写入。
        if (block.table_cell) return '';

        switch (block.block_type) {
            case 2: if (block.text) blockMarkdown += renderElements(block.text.elements, true) + '\n\n'; break;
            case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 11:
                // eslint-disable-next-line no-case-declarations
                const level = block.block_type - 2;
                // eslint-disable-next-line no-case-declarations
                const headingKey = `heading${level}`;
                if (block[headingKey]) blockMarkdown += `${'#'.repeat(level)} ${renderElements(block[headingKey].elements)}\n\n`;
                break;
            case 12: if (block.bullet) blockMarkdown += `- ${renderElements(block.bullet.elements)}\n`; break;
            case 13: if (block.ordered) blockMarkdown += `1. ${renderElements(block.ordered.elements)}\n`; break;
            case 14: if (block.code) {
                const lang = block.code.style?.language || '';
                blockMarkdown += `\`\`\`${lang}\n${renderElements(block.code.elements)}\n\`\`\`\n\n`;
            } break;
            case 15: if (block.quote) blockMarkdown += `> ${renderElements(block.quote.elements)}\n\n`; break;
            case 17:
                if (block.todo) {
                    const isDone = block.todo.style?.done ? 'x' : ' ';
                    blockMarkdown += `- [${isDone}] ${renderElements(block.todo.elements)}\n`;
                }
                break;
            case 22: blockMarkdown += `---\n\n`; break;
            case 27: if (block.image) blockMarkdown += `![image](/api/v1/image/${block.image.token})\n\n`; break;
            case 30:
                if (block.sheet) {
                    try {
                        const fullToken = block.sheet.token;
                        const token = fullToken.split('_')[0];
                        const sheetId = fullToken.split('_')[1];
                        if (token && sheetId && feishuClient) {
                            const res = await feishuClient.request({
                                method: 'GET',
                                url: `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${token}/values/${sheetId}`
                            });
                            const values = res.data?.valueRange?.values;
                            if (values && values.length > 0) {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                values.forEach((row: any[], rowIndex: number) => {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    blockMarkdown += '| ' + row.map((v: any) => {
                                        let cellContent = '';
                                        if (v === null || v === undefined) {
                                            cellContent = '';
                                        } else if (Array.isArray(v)) {
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            cellContent = v.map((item: any) => item.text || '').join('');
                                        } else if (typeof v === 'object') {
                                            cellContent = v.text || v.value || JSON.stringify(v);
                                        } else {
                                            cellContent = String(v);
                                        }
                                        return cellContent.replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
                                    }).join(' | ') + ' |\n';

                                    if (rowIndex === 0) {
                                        blockMarkdown += '| ' + row.map(() => '---').join(' | ') + ' |\n';
                                    }
                                });
                                blockMarkdown += '\n';
                            }
                        }
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } catch (e: any) {
                        console.error('拉取飞书表格数据失败:', e.message);
                    }
                }
                break;
        }

        if (block.children && block.children.length > 0) {
            for (const childId of block.children) {
                let childMarkdown = await processBlock(childId);
                if (block.block_type === 34) {
                    childMarkdown = childMarkdown.split('\n')
                        .map(line => {
                            return line.trim().length > 0 ? `> ${line}` : '>';
                        })
                        .join('\n');
                    if (!childMarkdown.endsWith('\n')) childMarkdown += '\n';
                }
                blockMarkdown += childMarkdown;
            }
        }

        return blockMarkdown;
    };

    if (rootBlock.children) {
        for (const childId of rootBlock.children) markdown += await processBlock(childId);
    }
    return markdown.trim();
  }
}
