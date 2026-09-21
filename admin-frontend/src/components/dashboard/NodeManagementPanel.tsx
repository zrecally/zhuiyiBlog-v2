import type { NodeStatus } from '../admin/adminTypes';

interface NodeManagementPanelProps {
  nodes: NodeStatus[];
}

const statusText = (status: NodeStatus['status']) => ({
  online: '正常',
  configured: '已配置',
  warning: '告警',
  offline: '不可达',
  not_configured: '未配置',
}[status]);

const nodeBorderClass = (status: NodeStatus['status']) => {
  if (status === 'online') return 'border-xianxia-jade/40 bg-xianxia-jade/5';
  if (status === 'warning' || status === 'configured') return 'border-yellow-600/40 bg-yellow-600/5';
  return 'border-xianxia-red/40 bg-xianxia-red/5';
};

const nodeLabelClass = (status: NodeStatus['status']) => {
  if (status === 'online') return 'border-xianxia-jade text-xianxia-jade';
  if (status === 'warning' || status === 'configured') return 'border-yellow-600 text-yellow-600';
  return 'border-xianxia-red text-xianxia-red';
};

export const NodeManagementPanel = ({ nodes }: NodeManagementPanelProps) => (
  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
    <h2 className="text-2xl font-kai tracking-widest border-b border-xianxia-border/50 pb-4">节点监控与心跳管理</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin">
      {nodes.length === 0 && <p className="text-[12px] text-xianxia-text/50">暂无节点数据</p>}
      {nodes.map((node) => (
        <div key={node.id} className={`p-4 border ${nodeBorderClass(node.status)} relative overflow-hidden group`}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="font-song font-bold text-[14px] tracking-wider mb-1">{node.name}</h3>
              <p className="text-[10px] font-mono text-xianxia-text/60">{node.type}</p>
            </div>
            <div className={`px-2 py-0.5 border text-[10px] font-bold tracking-widest ${nodeLabelClass(node.status)}`}>
              {statusText(node.status)}
            </div>
          </div>
          {node.message && <p className="text-[11px] font-song text-yellow-600 mb-3 border-l-2 border-yellow-600 pl-2">{node.message}</p>}
          <div className="grid grid-cols-2 gap-4 border-t border-xianxia-border/30 pt-3">
            <NodeMetric label="网络延迟" value={node.latency === null ? '—' : `${node.latency}ms`} className={`text-lg ${node.status === 'offline' ? 'text-xianxia-red' : 'text-xianxia-text'}`} />
            <NodeMetric label="检测时间" value={new Date(node.checkedAt).toLocaleTimeString()} className="text-xianxia-text/80 text-[11px] mt-1" />
          </div>
          {!node.isThirdParty && node.details && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] font-song pt-3 mt-3 border-t border-xianxia-border/30 bg-xianxia-bg/30 p-2">
              {node.details.map((detail) => (
                <div key={detail.label} className="contents">
                  <span className="text-xianxia-text/50">{detail.label}</span>
                  <span className="text-xianxia-text font-mono text-right truncate" title={detail.value}>{detail.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

const NodeMetric = ({ label, value, className }: { label: string; value: string; className: string }) => (
  <div>
    <p className="text-[10px] text-xianxia-text/50 tracking-widest mb-1">{label}</p>
    <p className={`font-mono ${className}`}>{value}</p>
  </div>
);
