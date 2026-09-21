import { lazy, Suspense, useState, useEffect} from'react';
import { ExternalLink, X} from'lucide-react';
import { useToast} from'../components/Toast';
import { useTranslation } from 'react-i18next';
import { fetchStaticSnapshot, isStaticSite } from '../lib/siteMode';

const MarkdownContent = lazy(() => import('../components/markdown/MarkdownContent').then(module => ({ default: module.MarkdownContent })));

interface Project {
 id: string;
 name: string;
 link: string;
 cover: string;
 description: string;
 content?: string;
 tags: string[];
 status: string;
}

export const Projects = ({ isHome = false}: { isHome?: boolean}) => {
 const { t } = useTranslation();
 const [projects, setProjects] = useState<Project[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [selectedProject, setSelectedProject] = useState<Project | null>(null);
 const { showToast} = useToast();

 useEffect(() => {
 const fetchProjects = async () => {
 try {
   if (isStaticSite) {
     setProjects(await fetchStaticSnapshot<Project[]>('projects.json'));
   } else {
     const response = await fetch('/api/v1/projects');
     const result = await response.json();

     if (result.success) {
       setProjects(result.data);
     } else {
       showToast({ message: result.message || t('获取项目集失败'), type:'error'});
     }
   }
  } catch (error) {
   console.error('Failed to fetch projects:', error);
   showToast({ message: t('网络错误，获取项目集失败'), type:'error'});
  } finally {
 setIsLoading(false);
}
};

 fetchProjects();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [showToast]);

 return (
 <div className={`max-w-4xl mx-auto px-7 xl:px-0 ${isHome ?'mt-4 mb-8' :'mt-20 md:mt-24 mb-12'}`}>
 {!isHome && (
 <div className="relative z-20 w-full mx-auto lg:mx-0 text-center">
 <h2 className="text-3xl font-bold tracking-[0.5em] text-xianxia-text sm:text-4xl lg:text-5xl :text-3xl :text-4xl mb-6 font-kai ml-[0.5em]">
 项目
 </h2>

 <div className="flex items-center justify-center w-full max-w-xs mx-auto opacity-40 mb-10">
 <div className="h-px w-full bg-gradient-to-r from-transparent to-xianxia-red"></div>
 <div className="w-1.5 h-1.5 rounded-full border border-xianxia-red mx-3 flex-shrink-0 animate-pulse"></div>
 <div className="h-px w-full bg-gradient-to-l from-transparent to-xianxia-red"></div>
 </div>
 </div>
 )}

 {isLoading ? (
 <div className="flex flex-col items-center justify-center py-20 space-y-4">
 <div className="w-8 h-8 animate-spin text-xianxia-red">
 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
 </svg>
   </div>
   <p className="text-sm font-serif tracking-widest text-xianxia-text/60">{t('正在翻找那些没写完的破烂项目')}...</p>
   </div>
 ) : projects.length > 0 ? (
 <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 ${isHome ?'mt-4' :'mt-12'}`}>
 {projects.map((project, index) => (
 <div
 key={project.id}
 onClick={() => setSelectedProject(project)}
 className="cursor-pointer group flex flex-col bg-white/70 border border-xianxia-red/20 hover:border-xianxia-red/60 :border-[#C83C23]/50 rounded-xl overflow-hidden transition-all duration-500 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] :shadow-[0_8px_30px_rgb(0,0,0,0.1)] hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-8 backdrop-blur-sm"
 style={{ animationDelay: `${index * 100}ms`, animationDuration:'800ms'}}
 >
 {/* 封面图 */}
 <div className="relative w-full h-44 bg-xianxia-bg overflow-hidden border-b border-xianxia-red/10">
 {project.cover ? (
 <>
 <img
 src={project.cover}
 alt={project.name}
 className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
 />
 <div className="absolute inset-0 bg-neutral-900/10 group-hover:bg-transparent transition-colors duration-500"></div>
 </>
 ) : (
 <div className="absolute inset-0 flex items-center justify-center font-kai text-4xl text-xianxia-text/10">
 <span className="group-hover:scale-110 transition-transform duration-500">
 {project.name.charAt(0)}
 </span>
 </div>
 )}
 {/* 状态标签 */}
 {project.status && (
 <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded text-[10px] font-serif tracking-widest uppercase text-[#EAE5D9] shadow-sm border border-white/10 flex items-center gap-1.5">
 <span className="w-1 h-1 rounded-full bg-xianxia-red animate-pulse"></span>
 {project.status}
 </div>
 )}
 </div>

 {/* 内容区 */}
 <div className="flex flex-col flex-1 p-5 relative">
 <div className="flex items-start justify-between mb-3">
 <h3 className="text-lg font-bold font-kai tracking-widest text-xianxia-text line-clamp-1 group-hover:text-xianxia-red :text-[#C83C23] transition-colors">
 {project.name}
 </h3>
 {project.link && (
 <a
 href={project.link}
 target="_blank"
 rel="noopener noreferrer"
 onClick={(e) => e.stopPropagation()}
 className="mt-1 text-xianxia-text/30 hover:text-xianxia-red :text-[#C83C23] transition-colors transform hover:translate-x-0.5 hover:-translate-y-0.5 duration-300"
 >
 <ExternalLink className="w-4 h-4" />
 </a>
 )}
 </div>

 <p className="text-[13px] leading-relaxed font-serif text-xianxia-text/70 line-clamp-3 mb-6 flex-1">
   {project.description || `${t('暂无描述')}...`}
   </p>

 {/* 标签 */}
 {project.tags && project.tags.length > 0 && (
 <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-xianxia-red/10">
 {project.tags.map(tag => (
 <span
 key={tag}
 className="px-2.5 py-1 text-[10px] font-serif tracking-widest text-xianxia-red bg-xianxia-red/5 rounded border border-xianxia-red/10"
 >
 {tag}
 </span>
 ))}
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 ) : null}

 {/* 项目详情弹窗 */}
 {selectedProject && (
 <div
 className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300"
 onClick={() => setSelectedProject(null)}
 >
 <div
 className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#FAFAFA] border border-xianxia-red/20 rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300"
 onClick={e => e.stopPropagation()}
 >
 {/* 封面图 */}
 {selectedProject.cover && (
 <div className="w-full h-32 sm:h-40 shrink-0 bg-neutral-100 border-b border-xianxia-red/10">
 <img src={selectedProject.cover} alt={selectedProject.name} className="w-full h-full object-cover" />
 </div>
 )}

 {/* 关闭按钮 */}
 <button
 onClick={() => setSelectedProject(null)}
 className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-black/40 text-white rounded-full backdrop-blur z-10 hover:bg-xianxia-red transition-colors"
 >
 <X className="w-4 h-4" />
 </button>

 {/* 内容区 */}
 <div className="p-6 sm:p-8 flex flex-col min-h-0">
 <div className="flex items-center gap-4 mb-4 shrink-0">
 <h2 className="text-2xl font-bold font-kai tracking-widest text-xianxia-text">
 {selectedProject.name}
 </h2>
 {selectedProject.status && (
 <span className="px-2 py-1 bg-xianxia-red/10 text-xianxia-red text-[10px] rounded border border-xianxia-red/20 font-serif tracking-widest uppercase flex items-center gap-1.5 shrink-0">
 <span className="w-1 h-1 rounded-full bg-xianxia-red animate-pulse"></span>
 {selectedProject.status}
 </span>
 )}
 </div>

 <div className="overflow-y-auto pr-4 mb-6 scrollbar-thin scrollbar-thumb-xianxia-red/20 scrollbar-track-transparent">
 <div className="prose prose-sm max-w-none font-serif prose-p:leading-loose prose-a:text-xianxia-red prose-strong:text-xianxia-red">
 <Suspense fallback={<p className="py-8 text-center text-sm text-xianxia-text/50">正在加载项目详情...</p>}>
 <MarkdownContent content={selectedProject.content || selectedProject.description || '暂无详细描述...'} />
 </Suspense>
 </div>
 </div>

 <div className="flex items-center justify-between pt-6 border-t border-xianxia-red/10 shrink-0">
 <div className="flex flex-wrap gap-2">
 {selectedProject.tags?.map(tag => (
 <span
 key={tag}
 className="px-2.5 py-1 text-[10px] font-serif tracking-widest text-xianxia-red bg-xianxia-red/5 rounded border border-xianxia-red/10"
 >
 {tag}
 </span>
 ))}
 </div>

 {selectedProject.link && (
 <a
 href={selectedProject.link}
 target="_blank"
 rel="noopener noreferrer"
 className="flex items-center gap-2 px-5 py-2 bg-xianxia-red/10 hover:bg-xianxia-red text-xianxia-red hover:text-white :bg-[#C83C23] :text-white rounded-full transition-colors text-xs font-serif tracking-widest border border-xianxia-red/20"
   >
   <span>{t('访问项目')}</span>
   <ExternalLink className="w-3.5 h-3.5" />
 </a>
 )}
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};
