interface EasterEggModalProps {
  open: boolean;
  poem: { text: string; author: string };
  onClose: () => void;
}

export const EasterEggModal = ({ open, poem, onClose }: EasterEggModalProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] bg-xianxia-text/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto transition-opacity duration-500">
      <div className="relative bg-xianxia-bg/90 p-10 rounded-[2rem] shadow-2xl max-w-md w-full mx-4 flex flex-col items-center text-center transform transition-all scale-100 animate-in zoom-in-95 border border-xianxia-border/50 backdrop-blur-xl">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-xianxia-jade/40 to-transparent opacity-30" />
        <div className="mb-6 mt-4">
          <p className="text-xl md:text-2xl font-serif text-xianxia-text/90 leading-relaxed tracking-wide">&quot;{poem.text}&quot;</p>
          <p className="text-sm text-xianxia-text/60 mt-6 font-medium">— {poem.author}</p>
        </div>
        <button onClick={onClose} className="mt-4 px-8 py-2.5 bg-xianxia-bg/80 hover:bg-xianxia-jade/20 text-xianxia-text/60 rounded-full text-sm font-medium transition-colors duration-300">溜了溜了</button>
      </div>
    </div>
  );
};
