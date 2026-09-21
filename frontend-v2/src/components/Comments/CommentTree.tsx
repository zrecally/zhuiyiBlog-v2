import DOMPurify from 'dompurify';
import { Forward, MessageSquare, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { ReactNode } from 'react';
import { CurrentCommentUser, ParsedComment } from './commentTypes';
import { formatCommentDate } from './commentUtils';

interface CommentTreeProps {
  comments: ParsedComment[];
  currentUser: CurrentCommentUser | null;
  activeReplyId: string | number | null;
  onAction: (id: string | number, action: 'like' | 'dislike') => void;
  onDelete: (id: string | number) => void;
  onReply: (comment: ParsedComment) => void;
  onShare: () => void;
  renderReply: (comment: ParsedComment) => ReactNode;
}

export const CommentTree = ({ comments, ...props }: CommentTreeProps) => (
  <ul className="m-0 p-0 list-none">
    {comments.map((comment) => <CommentNode key={comment.id} comment={comment} depth={0} {...props} />)}
  </ul>
);

interface CommentNodeProps extends Omit<CommentTreeProps, 'comments'> {
  comment: ParsedComment;
  depth: number;
}

const CommentNode = ({ comment, depth, currentUser, activeReplyId, onAction, onDelete, onReply, onShare, renderReply }: CommentNodeProps) => (
  <li className={`mb-[20px] relative after:content-[''] after:table after:clear-both ${depth > 0 ? 'ml-[20px] sm:ml-[40px] mt-4 border-l-2 border-neutral-100 pl-3 sm:pl-4' : ''}`}>
    <div className="rounded-full block float-left mr-[14px] p-0 relative w-[40px] h-[40px] sm:w-[48px] sm:h-[48px] overflow-hidden">
      <img src={comment.user.avatar || '/avatars/default.svg'} alt="avatar" className="block w-full h-full object-cover" />
      <img src={comment.user.avatarDark || comment.user.avatar || '/avatars/default.svg'} alt="avatar" className="hidden w-full h-full object-cover opacity-95" />
    </div>
    <div className="overflow-hidden">
      <div className="font-[14px] leading-[1] mb-[8px] flex items-center flex-wrap gap-y-1">
        <span className="text-[#37475b] font-bold text-[14px]">{comment.user.username}</span>
        {comment.user.username === 'admin' && <span className="bg-[#076dd0] rounded-[3px] text-white inline-block text-[11px] font-bold leading-[1] ml-[6px] px-[4px] py-[2px] shadow-sm">执卷人</span>}
        {comment.replyTo && depth > 0 && <span className="text-neutral-400 text-[11px] sm:text-[12px] font-medium ml-2 flex items-center gap-1"><Forward className="w-3 h-3 inline" /><span className="text-[#076dd0]">@{comment.replyTo}</span></span>}
        <span className="text-[#8b98a7] inline-block text-[11px] sm:text-[12px] font-medium before:content-['·'] before:font-bold before:text-[#c2c6cc] before:mx-[4px] ml-[2px]">{formatCommentDate(comment.createdAt)}</span>
      </div>
      <div className="break-words text-[#37475b] text-[15px] leading-[1.7] overflow-hidden whitespace-pre-wrap prose prose-p:my-1 prose-a:text-[#076dd0] hover:prose-a:underline max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.content, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'img', 'code', 'pre', 'blockquote'], ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class'] }) }} />
      <div className="mt-2.5 flex items-center gap-2 sm:gap-5 text-[#8b98a7] font-medium select-none whitespace-nowrap">
        <ActionButton icon={<ThumbsUp />} label={comment.likes && comment.likes > 0 ? String(comment.likes) : '赞'} onClick={() => onAction(comment.id, 'like')} />
        <ActionButton icon={<ThumbsDown />} label={comment.dislikes && comment.dislikes > 0 ? String(comment.dislikes) : '踩'} onClick={() => onAction(comment.id, 'dislike')} />
        <ActionButton icon={<MessageSquare />} label="回复" onClick={() => onReply(comment)} />
        <ActionButton icon={<Forward />} label="分享" onClick={onShare} />
        {(currentUser?.username === comment.user.username || currentUser?.role === 'admin') && <button className="flex items-center gap-1 sm:gap-1.5 hover:text-red-500 transition-colors outline-none bg-transparent group ml-auto" onClick={() => onDelete(comment.id)} title="删除评论"><Trash2 className="w-[13px] h-[13px] sm:w-[14px] sm:h-[14px]" /><span className="text-[11px] sm:text-[12px]">删除</span></button>}
      </div>
    </div>
    {activeReplyId === comment.id && <div className="mt-4 mb-2 ml-[10px] sm:ml-[54px] animate-in fade-in slide-in-from-top-2 duration-300">{renderReply(comment)}</div>}
    {comment.children?.length > 0 && <ul className="m-0 p-0 list-none mt-4">{comment.children.map((child) => <CommentNode key={child.id} comment={child} depth={depth + 1} currentUser={currentUser} activeReplyId={activeReplyId} onAction={onAction} onDelete={onDelete} onReply={onReply} onShare={onShare} renderReply={renderReply} />)}</ul>}
  </li>
);

const ActionButton = ({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) => (
  <button onClick={onClick} className="flex items-center gap-1 sm:gap-1.5 hover:text-[#076dd0] transition-colors outline-none bg-transparent group [&>svg]:w-[13px] [&>svg]:h-[13px] sm:[&>svg]:w-[14px] sm:[&>svg]:h-[14px]">
    {icon}<span className="text-[11px] sm:text-[12px]">{label}</span>
  </button>
);
