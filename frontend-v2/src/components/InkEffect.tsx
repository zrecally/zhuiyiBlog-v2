import { useEffect, useState} from'react';

export const InkEffect = () => {
 const [drops, setDrops] = useState<{ id: number; x: number; y: number; size: number}[]>([]);
 const [isMobile, setIsMobile] = useState(false);

 useEffect(() => {
 // 检查是否为移动端设备，如果是，则不渲染特效以节省性能
 const checkMobile = () => {
 setIsMobile(window.innerWidth < 768);
};

 checkMobile();
 window.addEventListener('resize', checkMobile);
 return () => window.removeEventListener('resize', checkMobile);
}, []);

 useEffect(() => {
 if (isMobile) return;

 const handleClick = (e: MouseEvent) => {
 // 只有在暗黑（水墨）模式下才触发墨滴效果，并且不拦截输入框和链接等原生交互
 if (!document.documentElement.classList.contains('dark')) return;

 const id = Date.now();
 // 缩小初始生成的墨滴基础尺寸
 const size = 25 + Math.random() * 20; // 25px - 45px

 setDrops(prev => [...prev, { id, x: e.clientX, y: e.clientY, size}]);

 // 动画结束后移除元素 (Tailwind 动画设为 1.2s，给 1.5s 足够余量)
 setTimeout(() => {
 setDrops(prev => prev.filter(drop => drop.id !== id));
}, 1500);
};

 window.addEventListener('click', handleClick);
 return () => window.removeEventListener('click', handleClick);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

 if (isMobile) return null;

 return (
 <>
 <svg width="0" height="0" className="absolute pointer-events-none">
 <defs>
 <filter id="ink-spread" x="-100%" y="-100%" width="300%" height="300%">
 {/* 生成分形噪声纹理 */}
 <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" result="noise" />
 {/* 根据噪声对圆形进行随机形变拉扯，模拟毛边。由于墨滴缩小，这里的拉扯幅度也相应减小 */}
 <feDisplacementMap in="SourceGraphic" in2="noise" scale="20" xChannelSelector="R" yChannelSelector="G" result="displaced" />
 {/* 轻微模糊融合 */}
 <feGaussianBlur in="displaced" stdDeviation="2" />
 </filter>
 </defs>
 </svg>

 <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
 {drops.map(drop => (
 <div
 key={drop.id}
 className="absolute origin-center animate-ink-bloom mix-blend-multiply"
 style={{
 left: drop.x,
 top: drop.y,
 width: 0,
 height: 0,
 willChange:'transform, opacity'
}}
 >
 {/* 浅色大晕染 */}
 <div
 className="absolute rounded-full"
 style={{
 left: -drop.size / 2,
 top: -drop.size / 2,
 width: drop.size,
 height: drop.size,
 background:'#1A1A1A',
 opacity: 0.4,
 filter:'url(#ink-spread)'
}}
 />
 {/* 深色小核心 */}
 <div
 className="absolute rounded-full"
 style={{
 left: -drop.size / 4,
 top: -drop.size / 4,
 width: drop.size / 2,
 height: drop.size / 2,
 background:'#1A1A1A',
 opacity: 0.8,
 filter:'url(#ink-spread)'
}}
 />
 </div>
 ))}
 </div>
 </>
 );
};
