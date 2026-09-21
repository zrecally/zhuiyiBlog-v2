import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, RefreshCw, ZoomIn, X } from 'lucide-react';
import { fetchStaticSnapshot, isStaticSite } from '../lib/siteMode';
import { useTranslation } from 'react-i18next';

interface AlbumPhoto {
  id: string;
  title: string;
  caption: string;
  width: number;
  height: number;
  takenAt: string | null;
  featured: boolean;
  tags: string[];
  imageUrl: string;
  thumbnailUrl: string;
}

interface AlbumPageData {
  items: AlbumPhoto[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

const tiltClasses = ['-rotate-1', 'rotate-1', '-rotate-2', 'rotate-2'];

const PhotoTack = () => (
  <span className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
    <span className="block h-4 w-4 rounded-full border border-[#8d271b]/50 bg-xianxia-red shadow-[0_3px_7px_rgba(83,35,24,0.35)]" />
    <span className="absolute left-1/2 top-3 block h-3 w-px -translate-x-1/2 bg-xianxia-text/25" />
  </span>
);

const AlbumLightbox = ({ photo, onClose }: { photo: AlbumPhoto; onClose: () => void }) => {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${photo.title}大图预览`}>
      <button type="button" className="absolute inset-0 cursor-zoom-out" onClick={onClose} aria-label="关闭大图预览" />
      <figure className="relative z-10 w-full max-w-5xl bg-[#f4efe4] p-3 pb-5 shadow-2xl sm:p-5 sm:pb-7">
        <PhotoTack />
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center bg-xianxia-bg/90 text-xianxia-text shadow hover:text-xianxia-red" aria-label="关闭大图预览">
          <X className="h-5 w-5" />
        </button>
        <div className="flex min-h-[280px] max-h-[72vh] items-center justify-center overflow-hidden bg-[#ded8cb]">
          <img src={photo.imageUrl} alt={photo.caption || photo.title} className="max-h-[72vh] w-full object-contain" />
        </div>
        <figcaption className="mt-4 px-1 font-serif">
          <p className="text-base tracking-[0.16em] text-xianxia-text">{photo.title}</p>
          {photo.caption && <p className="mt-1 text-xs leading-6 tracking-wider text-xianxia-text/50">{photo.caption}</p>}
          {photo.tags.length > 0 && <p className="mt-2 text-[10px] tracking-[0.16em] text-xianxia-red/60">{photo.tags.join(' · ')}</p>}
        </figcaption>
      </figure>
    </div>
  );
};

export const AlbumPage = () => {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const [selectedPhoto, setSelectedPhoto] = useState<AlbumPhoto | null>(null);

  const loadPhotos = useCallback(async (nextPage = 1, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      let data: AlbumPageData;
      if (isStaticSite) {
        data = await fetchStaticSnapshot<AlbumPageData>('album.json');
      } else {
        const response = await fetch(`/api/v1/albums?page=${nextPage}&limit=24`, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload.success || !payload.data) throw new Error(payload.message || '相册数据无效');
        data = payload.data as AlbumPageData;
      }

      setPhotos(current => append ? [...current, ...data.items] : data.items);
      setPage(data.page || nextPage);
      setTotal(data.total ?? data.items.length);
      setHasMore(!isStaticSite && data.hasMore === true);
    } catch (loadError) {
      console.error('[Album] 读取相册失败:', loadError);
      setError(t('相册暂时没有整理好，请稍后再试。'));
      if (!append) setPhotos([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  const visiblePhotos = useMemo(
    () => photos.filter(photo => !failedSources.has(photo.thumbnailUrl)),
    [failedSources, photos],
  );

  const markFailed = (source: string) => {
    setFailedSources(current => new Set(current).add(source));
  };

  return (
    <div className="mx-auto mt-20 w-full max-w-5xl px-5 pb-28 font-kai text-xianxia-text sm:px-8 md:mt-24">
      <section className="relative z-20 mx-auto mb-16 w-full max-w-3xl text-center md:mb-24">
        <h1 className="ml-[0.5em] text-3xl font-bold leading-tight tracking-[0.5em] sm:text-4xl lg:text-5xl">{t('相册')}</h1>
        <div className="mx-auto mb-9 mt-6 flex w-full max-w-xs items-center justify-center opacity-40">
          <div className="h-px w-full bg-gradient-to-r from-transparent to-xianxia-red" />
          <div className="mx-3 h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full border border-xianxia-red" />
          <div className="h-px w-full bg-gradient-to-l from-transparent to-xianxia-red" />
        </div>
        <p className="mx-auto max-w-xl font-serif text-sm leading-8 tracking-wider text-xianxia-text/60 sm:text-base">
          把日常光影收进纸页，一张张轻轻钉在这里。
        </p>
        <p className="mt-7 inline-flex items-center gap-2 font-serif text-xs tracking-widest text-xianxia-text/45">
          <ImageIcon className="h-4 w-4 text-xianxia-jade" />
          {loading ? '正在整理' : `${total} 张照片`}
        </p>
      </section>

      {loading ? (
        <div className="grid max-w-5xl grid-cols-1 gap-10 py-8 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map(index => (
            <div key={index} className="relative">
              <div className="aspect-[4/3] animate-pulse border border-xianxia-border/60 bg-xianxia-card/60 p-3">
                <div className="h-full bg-xianxia-border/25" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mx-auto max-w-3xl border-y border-xianxia-border/60 py-20 text-center font-serif">
          <p className="text-sm tracking-widest text-xianxia-text/55">{error}</p>
          <button type="button" onClick={() => void loadPhotos()} className="mt-6 inline-flex items-center gap-2 border border-xianxia-border px-5 py-2 text-xs tracking-widest hover:border-xianxia-red hover:text-xianxia-red">
            <RefreshCw className="h-3.5 w-3.5" />重新整理
          </button>
        </div>
      ) : visiblePhotos.length === 0 ? (
        <div className="mx-auto max-w-3xl border-y border-xianxia-border/60 py-24 text-center font-serif">
          <ImageIcon className="mx-auto h-7 w-7 text-xianxia-text/25" />
          <p className="mt-5 text-sm tracking-widest text-xianxia-text/55">{t('相册里还没有照片')}</p>
          <p className="mt-2 text-xs tracking-wider text-xianxia-text/35">{t('在飞书相册表发布第一张生活照片后，它会被钉在这里。')}</p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-10 py-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="生活照片墙">
            {visiblePhotos.map((photo, index) => (
              <article key={photo.id} className="relative min-w-0 px-2 pt-2">
                <button type="button" onClick={() => setSelectedPhoto(photo)} className={`group relative block w-full bg-[#f4efe4] p-3 pb-5 text-left transition duration-500 hover:z-20 hover:-translate-y-1 hover:rotate-0 ${tiltClasses[index % tiltClasses.length]}`} aria-label={`查看图片：${photo.title}`}>
                  <PhotoTack />
                  <div className="relative overflow-hidden bg-[#dcd5c8]" style={{ aspectRatio: `${Math.max(1, photo.width)} / ${Math.max(1, photo.height)}` }}>
                    <img src={photo.thumbnailUrl} alt={photo.caption || photo.title} loading="lazy" onError={() => markFailed(photo.thumbnailUrl)} className="h-full w-full object-cover saturate-[0.82] transition duration-700 group-hover:scale-[1.025] group-hover:saturate-100" />
                    <span className="absolute inset-0 ring-1 ring-inset ring-black/5" />
                    <span className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-xianxia-bg/80 text-xianxia-text/55 opacity-0 shadow transition group-hover:opacity-100" aria-hidden="true"><ZoomIn className="h-4 w-4" /></span>
                  </div>
                  <div className="mt-4 px-1 font-serif">
                    <h2 className="truncate text-sm tracking-[0.14em] text-xianxia-text">{photo.title}</h2>
                    {photo.caption && <p className="mt-1 line-clamp-2 text-[10px] leading-5 tracking-wider text-xianxia-text/45">{photo.caption}</p>}
                  </div>
                </button>
              </article>
            ))}
          </section>
          {hasMore && (
            <div className="mt-8 text-center">
              <button type="button" disabled={loadingMore} onClick={() => void loadPhotos(page + 1, true)} className="border border-xianxia-border px-8 py-3 font-serif text-xs tracking-[0.2em] text-xianxia-text/70 hover:border-xianxia-red hover:text-xianxia-red disabled:cursor-wait disabled:opacity-50">
                {loadingMore ? '正在取来照片' : '继续翻看'}
              </button>
            </div>
          )}
        </>
      )}

      {selectedPhoto && <AlbumLightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />}
    </div>
  );
};
