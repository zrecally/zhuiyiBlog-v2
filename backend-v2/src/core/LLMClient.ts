import OpenAI from 'openai';
import { config } from '../config';

class LLMClientManager {
  private client: OpenAI | null = null;

  constructor() {
    if (config.openaiApiKey) {
      this.client = new OpenAI({
        apiKey: config.openaiApiKey,
        baseURL: config.openaiBaseUrl,
      });
      console.log('[System] LLM API 客户端初始化成功 (支持后台翻译)');
    }
  }

  public getClient(): OpenAI | null {
    return this.client;
  }
}

export const llmClientManager = new LLMClientManager();
export const openai = llmClientManager.getClient();
