import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  OPERATION_TRACE_EVENT,
  type OperationTraceEntry,
} from './common/operationTrace';

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
 openTerminal: () => void;
}

interface TerminalEntry {
  id: number;
  type: ToastType;
  source: string;
  message: string;
  detail?: string;
  time: string;
  operationId?: string;
  phase?: OperationTraceEntry['phase'];
}

interface TerminalOperation {
  id: string;
  first: TerminalEntry;
  latest: TerminalEntry;
  steps: TerminalEntry[];
}

const MAX_TERMINAL_ENTRIES = 120;

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
 const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
 const [terminalCollapsed, setTerminalCollapsed] = useState(false);
 const [terminalPosition, setTerminalPosition] = useState<{ x: number; y: number } | null>(null);
 const [expandedOperationId, setExpandedOperationId] = useState<string | null>(null);
 const terminalRef = useRef<HTMLElement>(null);
 const terminalScrollRef = useRef<HTMLDivElement>(null);
 const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
 const latestCompletedOperationRef = useRef<{ id: string; at: number } | null>(null);

 const appendTerminalEntry = useCallback((entry: Omit<TerminalEntry, 'id' | 'time'>) => {
  const now = new Date();
  const terminalEntry: TerminalEntry = {
    ...entry,
    id: Date.now() + Math.floor(Math.random() * 1000),
    time: now.toLocaleTimeString('zh-CN', { hour12: false }),
  };
  setTerminalEntries((current) => [terminalEntry, ...current].slice(0, MAX_TERMINAL_ENTRIES));
 }, []);

 useEffect(() => {
  const onOperationTrace = (event: Event) => {
    const trace = (event as CustomEvent<OperationTraceEntry>).detail;
    if (!trace) return;
    appendTerminalEntry({
      type: trace.level,
      source: trace.source,
      message: trace.message,
      detail: trace.detail,
      operationId: trace.operationId,
      phase: trace.phase,
    });
    if (trace.operationId && trace.phase !== 'start') {
      latestCompletedOperationRef.current = { id: trace.operationId, at: Date.now() };
    }
  };
  window.addEventListener(OPERATION_TRACE_EVENT, onOperationTrace);
  return () => window.removeEventListener(OPERATION_TRACE_EVENT, onOperationTrace);
 }, [appendTerminalEntry]);

 const showToast = useCallback(({ message, type ='info', duration = 3000}: ToastOptions) => {
 const id = Date.now();
 setToast({ message, type, duration, id});
 const completedOperation = latestCompletedOperationRef.current;
 appendTerminalEntry({
  type,
  source: '控制台',
  message,
  detail: type === 'success' ? `执行成功：${message}` : type === 'error' ? `执行失败：${message}` : `处理提示：${message}`,
  operationId: completedOperation && Date.now() - completedOperation.at < 1500 ? completedOperation.id : undefined,
  phase: 'result',
 });

 setTimeout(() => {
 setToast((currentToast) => (currentToast?.id === id ? null : currentToast));
}, duration);
}, [appendTerminalEntry]);

 const terminalOperations = useMemo(() => {
  const operations = new Map<string, TerminalOperation>();
  for (const entry of [...terminalEntries].reverse()) {
    const id = entry.operationId || `single-${entry.id}`;
    const current = operations.get(id);
    if (current) {
      current.latest = entry;
      current.steps.push(entry);
    } else {
      operations.set(id, { id, first: entry, latest: entry, steps: [entry] });
    }
  }
  return [...operations.values()].sort((left, right) => left.latest.id - right.latest.id);
 }, [terminalEntries]);

 useEffect(() => {
  const terminalScroll = terminalScrollRef.current;
  if (!terminalScroll || terminalCollapsed) return;
  const frame = requestAnimationFrame(() => {
    terminalScroll.scrollTo({ top: terminalScroll.scrollHeight, behavior: 'smooth' });
  });
  return () => cancelAnimationFrame(frame);
 }, [terminalCollapsed, terminalOperations]);

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

 const startTerminalDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
  if ((event.target as HTMLElement).closest('button')) return;
  const terminal = terminalRef.current;
  if (!terminal) return;
  const bounds = terminal.getBoundingClientRect();
  dragOffsetRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  event.currentTarget.setPointerCapture(event.pointerId);
 }, []);

 const moveTerminal = useCallback((event: React.PointerEvent<HTMLElement>) => {
  const dragOffset = dragOffsetRef.current;
  const terminal = terminalRef.current;
  if (!dragOffset || !terminal) return;
  const bounds = terminal.getBoundingClientRect();
  setTerminalPosition({
    x: Math.min(Math.max(8, event.clientX - dragOffset.x), window.innerWidth - bounds.width - 8),
    y: Math.min(Math.max(8, event.clientY - dragOffset.y), window.innerHeight - bounds.height - 8),
  });
 }, []);

 const stopTerminalDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
  dragOffsetRef.current = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
 }, []);

 const openTerminal = useCallback(() => setTerminalCollapsed(false), []);

 return (
 <ToastContext.Provider value={{ showToast, showConfirm, openTerminal }}>
 {children}

 {/* 全局控制终端：保留每个控制面请求和业务操作的完整反馈链路。 */}
 {terminalCollapsed ? (
   <button
     type="button"
     onClick={openTerminal}
     className="fixed right-0 top-1/2 z-[999997] -translate-y-1/2 rounded-l-xl border border-r-0 border-xianxia-border/80 bg-xianxia-bg/95 px-2.5 py-4 text-[11px] font-mono tracking-[0.18em] text-xianxia-text shadow-[0_8px_22px_rgba(42,42,42,0.13)] transition hover:bg-[#f0eadf]"
     aria-label="展开终端反馈"
     title="展开终端反馈"
   >
     <span className="[writing-mode:vertical-rl]">终端反馈</span>
   </button>
 ) : (
   <section
     ref={terminalRef}
     className={`fixed z-[999997] flex w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-xianxia-border/90 bg-xianxia-bg/95 font-mono text-xianxia-text shadow-[0_14px_34px_rgba(42,42,42,0.15)] backdrop-blur-xl ${terminalPosition ? '' : 'bottom-5 right-5'}`}
     style={terminalPosition ? { left: terminalPosition.x, top: terminalPosition.y } : undefined}
     aria-label="全局终端反馈"
   >
     <header
       className="flex touch-none cursor-grab items-center justify-between border-b border-xianxia-border/75 bg-[#f0eadf]/85 px-3 py-2.5 active:cursor-grabbing"
       onPointerDown={startTerminalDrag}
       onPointerMove={moveTerminal}
       onPointerUp={stopTerminalDrag}
       onPointerCancel={stopTerminalDrag}
       title="拖动此处移动终端"
     >
       <div className="flex min-w-0 items-center gap-2">
         <span className="h-2 w-2 shrink-0 rounded-full bg-xianxia-jade shadow-[0_0_8px_rgba(74,107,88,0.55)]" />
         <span className="truncate text-xs tracking-[0.16em]">控制终端</span>
         <span className="text-[10px] text-xianxia-text/45">{terminalOperations.length} 项业务 · 可拖动</span>
       </div>
       <div className="flex items-center gap-1">
         <button
           type="button"
           onClick={() => setTerminalEntries([])}
           className="rounded px-2 py-1 text-[10px] text-xianxia-text/65 transition hover:bg-xianxia-jade/10 hover:text-xianxia-text"
           aria-label="清空终端记录"
         >
           清空
         </button>
         <button
           type="button"
           onClick={() => setTerminalCollapsed(true)}
           className="rounded px-2 py-1 text-sm leading-none text-xianxia-text/65 transition hover:bg-xianxia-jade/10 hover:text-xianxia-text"
           aria-label="收起终端反馈"
           title="收起到侧边"
         >
           →
         </button>
       </div>
     </header>
     <div ref={terminalScrollRef} className="max-h-72 min-h-28 overflow-y-auto px-3 py-2">
       {terminalOperations.length === 0 ? (
         <p className="py-5 text-center text-[11px] tracking-wide text-xianxia-text/50">
           等待控制面操作…请求链路会显示在这里
         </p>
       ) : terminalOperations.map((operation) => {
         const expanded = expandedOperationId === operation.id;
         const statusColor = operation.latest.type === 'success'
           ? 'bg-xianxia-jade'
           : operation.latest.type === 'error' ? 'bg-xianxia-red' : 'bg-[#b89b61]';
         return (
           <article key={operation.id} className="border-b border-xianxia-border/50 py-1.5 last:border-0">
             <button
               type="button"
               onClick={() => setExpandedOperationId(expanded ? null : operation.id)}
               className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left transition hover:bg-xianxia-jade/5"
               aria-expanded={expanded}
             >
               <time className="mt-0.5 shrink-0 text-[10px] text-xianxia-text/45">{operation.first.time}</time>
               <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
               <span className="min-w-0 flex-1">
                 <span className="block break-words text-[10px] leading-4 text-xianxia-text"><span className="text-xianxia-jade">[{operation.first.source}] </span>{operation.first.message}</span>
                 <span className="block break-words text-[10px] leading-4 text-xianxia-text/50">{operation.latest.detail || operation.latest.message}</span>
               </span>
               <span className="mt-0.5 shrink-0 text-[10px] text-xianxia-text/45">{operation.steps.length} 步 {expanded ? '⌃' : '⌄'}</span>
             </button>
             {expanded && (
               <ol className="ml-[4.5rem] mt-1 space-y-1 border-l border-xianxia-border/70 pl-2 text-[10px] leading-4 text-xianxia-text/60">
                 {operation.steps.map((step) => <li key={step.id}><span className="text-xianxia-text/40">{step.time} </span>{step.detail || step.message}</li>)}
               </ol>
             )}
           </article>
         );
       })}
     </div>
   </section>
 )}

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
