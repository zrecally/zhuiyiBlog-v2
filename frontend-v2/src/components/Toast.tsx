import React, { createContext, useContext, useState, useCallback, ReactNode} from'react';

type ToastType ='success' |'error' |'info';

interface ToastOptions {
 message: string;
 type?: ToastType;
 duration?: number;
}

interface ConfirmOptions {
 message: string;
 onConfirm: () => void;
 onCancel?: () => void;
}

interface ToastContextType {
 showToast: (options: ToastOptions) => void;
 showConfirm: (options: ConfirmOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
 const context = useContext(ToastContext);
 if (!context) {
 throw new Error('useToast must be used within a ToastProvider');
}
 return context;
};

export const ToastProvider: React.FC<{ children: ReactNode}> = ({ children}) => {
 const [toast, setToast] = useState<(ToastOptions & { id: number}) | null>(null);
 const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);

 const showToast = useCallback(({ message, type ='info', duration = 3000}: ToastOptions) => {
 const id = Date.now();
 setToast({ message, type, duration, id});

 setTimeout(() => {
 setToast((currentToast) => (currentToast?.id === id ? null : currentToast));
}, duration);
}, []);

 const showConfirm = useCallback((options: ConfirmOptions) => {
 setConfirmState(options);
 }, []);

 const handleConfirm = useCallback(() => {
 if (confirmState?.onConfirm) {
 confirmState.onConfirm();
 }
 setConfirmState(null);
 }, [confirmState]);

 const handleCancel = useCallback(() => {
 if (confirmState?.onCancel) {
 confirmState.onCancel();
 }
 setConfirmState(null);
 }, [confirmState]);

 return (
 <ToastContext.Provider value={{ showToast, showConfirm }}>
 {children}

 {/* Confirm Dialog UI */}
 {confirmState && (
   <div className="fixed inset-0 z-[999999] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center p-4">
     <div className="bg-white/90 backdrop-blur-xl border border-[#4A6B58]/20 rounded-2xl shadow-2xl p-6 max-w-sm w-full animate-in zoom-in-95 duration-200">
       <div className="flex items-center gap-3 mb-4">
         <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
           </svg>
         </div>
         <h3 className="text-lg font-serif font-bold text-[#1A1A1A]">操作确认</h3>
       </div>
       <p className="text-sm font-serif tracking-wide text-neutral-600 mb-6 leading-relaxed">
         {confirmState.message}
       </p>
       <div className="flex items-center justify-end gap-3">
         <button
           onClick={handleCancel}
           className="px-4 py-2 text-sm font-serif tracking-widest text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
         >
           取消
         </button>
         <button
           onClick={handleConfirm}
           className="px-4 py-2 text-sm font-serif tracking-widest bg-red-500/90 hover:bg-red-500 text-white rounded-lg transition-colors shadow-sm"
         >
           确认执行
         </button>
       </div>
     </div>
   </div>
 )}

 {/* 优雅的悬浮 Toast UI */}
 <div
 className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[999999] transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
 toast ?'opacity-100 translate-y-0 scale-100' :'opacity-0 translate-y-8 scale-95 pointer-events-none'
}`}
 >
 {toast && (
 <div className="flex items-center gap-3 px-6 py-3.5 bg-white/70 backdrop-blur-2xl border border-[#4A6B58]/20 rounded-full shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] (0,0,0,0.3)]">
 {toast.type ==='success' && (
 <svg className="w-5 h-5 text-[#4A6B58]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
 </svg>
 )}
 {toast.type ==='error' && (
 <svg className="w-5 h-5 text-red-500/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
 </svg>
 )}
 {toast.type ==='info' && (
 <svg className="w-5 h-5 text-[#4A6B58]/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 )}
 <span className="text-[14px] font-serif tracking-widest text-[#1A1A1A]">
 {toast.message}
 </span>
 </div>
 )}
 </div>
 </ToastContext.Provider>
 );
};
