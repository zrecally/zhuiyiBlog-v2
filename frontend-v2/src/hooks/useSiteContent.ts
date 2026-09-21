import { useEffect, useRef, useState } from 'react';
import { getCMSData, type CMSPost, type SiteConfig } from '../lib/cms';
import { fetchStaticSnapshot, isStaticSite } from '../lib/siteMode';

const cachedDynamicConfig = (): SiteConfig | null => {
  if (isStaticSite) return null;
  try {
    const cached = localStorage.getItem('zhuiyi_site_config');
    return cached ? JSON.parse(cached) as SiteConfig : null;
  } catch {
    return null;
  }
};

export const useSiteContent = (currentPath: string) => {
  const [posts, setPosts] = useState<CMSPost[]>([]);
  const [timelinePosts, setTimelinePosts] = useState<CMSPost[]>([]);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(cachedDynamicConfig);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const timelineLoaded = useRef(false);

  useEffect(() => {
    if (window.location.pathname.startsWith('/banned')) {
      setLoading(false);
      return;
    }

    const fetchPosts = async () => {
      setLoading(true);
      try {
        const cmsData = await getCMSData();
        setPosts(cmsData.posts);
        setSiteConfig(cmsData.config);
        setLoadError(false);
        if (!isStaticSite) localStorage.setItem('zhuiyi_site_config', JSON.stringify(cmsData.config));
      } catch (error) {
        console.error('Failed to fetch posts:', error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    void fetchPosts();
  }, []);

  useEffect(() => {
    if (!currentPath.startsWith('/timeline') || timelineLoaded.current) return;

    const controller = new AbortController();
    let active = true;
    setTimelineLoading(true);

    const fetchTimeline = async () => {
      try {
        let entries: CMSPost[] = [];
        if (isStaticSite) {
          const snapshot = await fetchStaticSnapshot<CMSPost[] | { posts?: CMSPost[]; timeline?: CMSPost[] }>('timeline.json');
          entries = Array.isArray(snapshot) ? snapshot : snapshot.posts || snapshot.timeline || [];
          const now = Date.now();
          entries = entries.filter((entry) => {
            if (!entry || (entry.isPrivate && entry.accessMode !== 'password') || entry.isPublished === false) return false;
            if (entry.status && String(entry.status).toLowerCase() !== 'published') return false;
            const publishTime = Date.parse(entry.date);
            return Number.isNaN(publishTime) || publishTime <= now;
          });
        } else {
          const token = localStorage.getItem('user_token');
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
          const response = await fetch(`${apiBaseUrl}/v1/timeline`, { headers, signal: controller.signal });
          if (!response.ok) throw new Error(`Timeline request failed: ${response.status}`);
          const payload = await response.json() as { success?: boolean; data?: CMSPost[] };
          entries = payload.success && Array.isArray(payload.data) ? payload.data : [];
        }

        if (active) {
          setTimelinePosts(entries);
          timelineLoaded.current = true;
        }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.warn('Failed to fetch timeline:', error);
          setTimelinePosts([]);
        }
      } finally {
        if (active) setTimelineLoading(false);
      }
    };

    void fetchTimeline();
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentPath]);

  return { posts, timelinePosts, siteConfig, loading, timelineLoading, loadError };
};
