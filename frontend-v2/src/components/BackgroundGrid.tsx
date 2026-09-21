export const BackgroundGrid = () => {
 return (
 <div className="pointer-events-none fixed inset-0 z-0 h-full w-full overflow-hidden" aria-hidden="true">
 {/* 无文字的宣纸水墨背景：左下青灰，右下淡朱砂。 */}
 <div
 className="absolute inset-0 bg-cover bg-center bg-no-repeat"
 style={{
 backgroundImage: 'url("/images/watercolor-global-background-v1.webp")',
 }}
 />
 </div>
 );
};
