import { fetchStaticSnapshot, isStaticSite } from './siteMode';

export interface CMSPost {
 id: string;
 title: string;
 summary: string;
 date: string;
 category: string;
 tags?: string[];
 isPrivate?: boolean;
 accessMode?: 'public' | 'approval' | 'password';
 showLockedMetadata?: boolean;
 views?: number;
 image: string;
 content: string;
 isPublished?: boolean;
 status?: string;
 accessStatus?: string;
 matchedInContent?: boolean;
 matchedSnippet?: string;
 searchQuery?: string;
}

export interface SiteConfig {
 title: string;
 subtitle: string;
 description: string;
 avatar: string;
 github?: string;
 twitter?: string;
 telegram?: string;
 email?: string;
 custom_font_url?: string;
 navLinks?: string;
 navlinks?: string;
}

export interface CMSData {
 posts: CMSPost[];
 config: SiteConfig;
}

const mockConfig: SiteConfig = {
 title:'ZhuiYi 博客',
 subtitle:'欢迎来到 ZhuiYi 博客系统',
 description:'这是一个基于 React + Vite + Node.js + Express + Prisma 构建的现代化博客系统。',
 avatar:''
};

export const getCMSData = async (): Promise<CMSData> => {
 try {
 if (isStaticSite) {
   const snapshot = await fetchStaticSnapshot<{
     posts?: CMSPost[];
     config?: SiteConfig;
   }>('posts_list.json');
   const now = Date.now();
   const publicPosts = (snapshot?.posts || []).filter((post) => {
     if (!post || (post.isPrivate && post.accessMode !== 'password') || post.isPublished === false) return false;
     if (post.status && post.status.toLowerCase() !== 'published') return false;

     const publishTime = Date.parse(post.date);
     return Number.isNaN(publishTime) || publishTime <= now;
   });

   return {
     posts: publicPosts,
     config: snapshot?.config || mockConfig,
   };
 }

 const token = localStorage.getItem('user_token');
 const headers: Record<string, string> = {};
 if (token) headers['Authorization'] = `Bearer ${token}`;

 // 请求后端聚合接口，后端有缓存实现“秒开”
    // CDN 加速开发预留逻辑（暂不实装，默认保留原逻辑）
    const useCdn = import.meta.env.VITE_USE_CDN_CACHE === 'true';
    const cdnBaseUrl = import.meta.env.VITE_CDN_BASE_URL || '';

    // 我们可以在前端并行拉取全局公开配置
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
    const [postsRes, configRes] = await Promise.all([
      fetch(useCdn && cdnBaseUrl ? `${cdnBaseUrl}/cache/posts_list.json` : `${apiBaseUrl}/v1/posts`, { headers }),
      fetch(`${apiBaseUrl}/v1/config/public`, { headers })
    ]);

    const data = await postsRes.json();
    const configData = await configRes.json();

    // 如果从 CDN 获取了列表，但因为没有后端权限校验（accessStatus），
    // 实际业务可能需要额外拉取权限，这里仅保留基本逻辑
    if (data.success && data.data) {

      let mergedConfig = data.data.config || mockConfig;
      // 如果后端公开配置接口返回成功，并且有数据，我们就使用它覆盖默认配置，提升实时性
      if (configData.success && configData.data) {
          const fetchedConfig = (configData.data as Array<{ key: string; value: string }>).reduce<Record<string, string>>((acc, item) => {
              acc[item.key] = item.value;
              return acc;
          }, {});
          mergedConfig = { ...mergedConfig, ...fetchedConfig };
      }

      return {
        posts: data.data.posts || [],
        config: mergedConfig
      };
} else {
 throw new Error(`后端返回异常: posts success=${data.success}`);
}
} catch (error) {
 if (!isStaticSite) {
   // 动态站后端故障时向上抛错，由页面展示错误状态；
   // 绝不能降级到模拟文章，否则读者会看到假内容且被 SEO 收录。
   throw error;
 }
 console.error("读取静态 CMS 快照失败:", error);
 return { posts: [], config: mockConfig};
}
};
