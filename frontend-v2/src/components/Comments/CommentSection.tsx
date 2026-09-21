import React, { lazy, Suspense } from 'react';
import { User, Send, Loader2, Heart, Link2, Forward, Image as ImageIcon, Smile, AtSign, Bold, Italic, Code, Quote } from 'lucide-react';
import type { Theme } from 'emoji-picker-react';
import { MagicLinkAuth } from '../common/MagicLinkAuth';
import { EditProfileModal } from './EditProfileModal';
import { CommentTree } from './CommentTree';
import { createComment, getCommentAuthToken } from './commentApi';
import { getPixelAvatar } from './commentUtils';
import { useCommentSection } from './useCommentSection';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

interface CommentSectionProps {
 postId: string;
}

export const CommentSection: React.FC<CommentSectionProps> = ({ postId }) => {
 const {
 activeReplyId, articleLikes, atFilter, atMenuPos, commentTree, comments,
 countdown, currentUser, editorRef, emojiPickerRef, fetchComments,
 fileInputRef, forceExpanded, formatText, handleAction, handleAtUser,
 handleDeleteComment, handleEmojiClick, handleImageUpload, handleLikeArticle,
 handleSendMagicLink, hasLikedArticle, isExpanded, isLikingArticle,
 isLoggedIn, isSendingMagic, isSubmitting, isUploadingImage, loading,
 magicEmail, magicMessage, newComment, randomPoem, replyContent,
 replyEditorRef, setActiveReplyId, setAtFilter, setAtMenuPos, setCurrentUser,
 setForceExpanded, setIsExpanded, setIsSubmitting, setMagicEmail,
 setNewComment, setReplyContent, setShowAtMenu, setShowEditProfile,
 setShowEmojiPicker, setSortOrder, showAtMenu, showEditProfile,
 showEmojiPicker, showMagicInput, showToast, sortOrder, uniqueUsernames,
 setShowMagicInput,
 } = useCommentSection(postId);

 const renderInputBox = (isReply: boolean = false, parentId?: string | number, replyToUsername?: string) => {
 const content = isReply ? replyContent : newComment;
 const setContent = isReply ? setReplyContent : setNewComment;
 const ref = isReply ? replyEditorRef : editorRef;
 const isExp = isReply ? true : (isExpanded || forceExpanded);
 const placeholderText = isReply ? `回复 @${replyToUsername}...` :"加入讨论吧...";

 const submitLocal = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!content.trim()) return;

 const token = getCommentAuthToken();
 if (!token) {
 window.dispatchEvent(new Event('open-magic-login'));
 return;
}

 setIsSubmitting(true);
 try {
 let finalContent = content;
 if (isReply && parentId && replyToUsername) {
 const meta = JSON.stringify({ parentId, replyTo: replyToUsername});
 finalContent = `${content}<!-- meta:${meta} -->`;
}

 const data = await createComment(postId, finalContent, token);
      if (data.success) {
        setContent('');
        if (ref.current) ref.current.innerHTML ='';
        if (isReply) setActiveReplyId(null);
        // fetchComments(); // 完全依赖 SSE 进行列表更新
      } else {
        showToast({ message: data.message || "评论失败", type: 'error' });
      }
    } catch (error) {
      console.error("提交评论失败", error);
      showToast({ message: "网络错误，评论失败", type: 'error' });
    } finally {
      setIsSubmitting(false);
      // 作为一个保险机制，在提交完成后 1 秒再静默拉取一次全量数据，
      // 以防止 SSE 意外丢失导致的界面不同步。
      setTimeout(() => fetchComments(), 1000);
    }
  };

 return (
 <div className="flex gap-[14px] items-start w-full">
 <div className="relative flex-shrink-0 mt-[6px] group hidden sm:block">
 <div className="w-[40px] h-[40px] sm:w-[48px] sm:h-[48px] rounded-full flex items-center justify-center text-neutral-500 overflow-hidden cursor-pointer">
 {currentUser ? (
 <>
 <img src={currentUser.avatar || getPixelAvatar(currentUser.username)} alt={currentUser.username} className="w-full h-full object-cover block" />
 <img src={currentUser.avatarDark || currentUser.avatar || getPixelAvatar(currentUser.username)} alt={currentUser.username} className="w-full h-full object-cover hidden opacity-95" />
 </>
 ) : (
 <User className="w-5 h-5 sm:w-6 sm:h-6 opacity-50" />
 )}
 </div>
 <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-neutral-900 text-white text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap shadow-xl z-50 pointer-events-none">
 {currentUser ? currentUser.username :'未登录'}
 <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-neutral-900 rotate-45"></div>
 </div>
 </div>
 <div className="flex-grow min-w-0">
 <form onSubmit={submitLocal}>
 <div className="relative z-10">
 {!isLoggedIn && (
 <div className="absolute inset-0 z-20 bg-white/50 backdrop-blur-[2px] rounded-3xl flex items-center justify-center border border-[#e6e8ee]">
 <span className="text-[#37475b] font-bold text-[14px]">
 请登录后参与讨论
 </span>
 </div>
 )}
 <div className={`border-2 border-[#e6e8ee] rounded-3xl bg-transparent shadow-sm flex flex-col transition-colors relative ${!isExp ?'overflow-hidden' :''}`}>
 {!content && (
 <div className="absolute top-[18px] left-5 text-[#8b98a7] text-[15px] pointer-events-none transition-opacity duration-300">
 {placeholderText}
 </div>
 )}

 {/* @唤起菜单面板 */}
 {showAtMenu && (
 <div
 className="absolute z-[100] bg-white border border-neutral-200 shadow-xl rounded-lg overflow-hidden flex flex-col"
 style={{ top: Math.max(0, atMenuPos.top), left: atMenuPos.left, minWidth:'180px', maxHeight:'200px'}}
 >
 <div className="p-2 border-b border-neutral-100 text-[11px] sm:text-[11px] sm:text-[12px] text-neutral-400 bg-neutral-50">
 提及用户
 </div>
 <div className="overflow-y-auto flex-1 custom-scrollbar">
 {uniqueUsernames.filter(u => atFilter ? u.toLowerCase().includes(atFilter.toLowerCase()) : true).length > 0 ? (
 uniqueUsernames.filter(u => atFilter ? u.toLowerCase().includes(atFilter.toLowerCase()) : true).map(username => (
 <button
 key={username}
 type="button"
 className="w-full text-left px-3 py-2 text-[13px] hover:bg-neutral-100 :bg-neutral-800 transition-colors flex items-center gap-2"
 onClick={() => handleAtUser(username)}
 >
 <div className="w-5 h-5 rounded-full overflow-hidden shrink-0 bg-neutral-200">
                      <img
                        src={'/avatars/default.svg'}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/avatars/default.svg';
                        }}
                      />
                      <img
                        src={'/avatars/default.svg'}
                        alt=""
                        className="hidden w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/avatars/default.svg';
                        }}
                      />
 </div>
 <span className="truncate">{username}</span>
 </button>
 ))
 ) : (
 <div className="px-3 py-4 text-center text-neutral-400 text-[11px] sm:text-[11px] sm:text-[12px]">未找到匹配的用户</div>
 )}
 </div>
 </div>
 )}

 <div
 ref={ref}
 contentEditable
 onInput={(e) => {
 if (ref.current) setContent(ref.current.innerHTML);
 const text = e.currentTarget.innerText;

 if (text.endsWith('@')) {
 const selection = window.getSelection();
 if (selection && selection.rangeCount > 0) {
 const range = selection.getRangeAt(0);
 const rect = range.getBoundingClientRect();
 const container = ref.current?.closest('.border-2');
 const containerRect = container ? container.getBoundingClientRect() : { top: 0, left: 0};
 setAtMenuPos({
 top: rect.bottom - containerRect.top + 5,
 left: rect.left - containerRect.left
});
 setShowAtMenu(true);
 setAtFilter('');
}
} else if (showAtMenu) {
 const match = text.match(/@([a-zA-Z0-9_\u4e00-\u9fa5]*)$/);
 if (match) {
 setAtFilter(match[1]);
} else {
 setShowAtMenu(false);
}
}
}}
 onClick={() => {
 if (!isReply) {
 setIsExpanded(true);
 setForceExpanded(true);
}
}}
 className={`w-full block bg-transparent border-0 outline-none text-[15px] text-[#37475b] resize-none leading-[1.6] transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
 isExp ?'p-5 h-[110px] overflow-y-auto' :'py-[18px] px-5 h-[60px] overflow-hidden'
}`}
 style={{ scrollbarWidth:'none', boxShadow:'none'}}
 />
 <div className={`w-full bg-transparent transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col ${isExp ?'max-h-[300px] opacity-100' :'max-h-0 opacity-0'}`}>
 <div className="h-px bg-[#e6e8ee] w-full shrink-0"></div>
 <div className="p-2 px-3 flex justify-between items-start sm:items-center grow flex-col sm:flex-row gap-2 sm:gap-0">
 <div className="flex items-center gap-0.5 flex-wrap sm:flex-nowrap">
 <button type="button" onMouseDown={(e) => { e.preventDefault(); formatText('bold', isReply);}} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent shrink-0"><Bold className="w-[16px] h-[16px]" /></button>
 <button type="button" onMouseDown={(e) => { e.preventDefault(); formatText('italic', isReply);}} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent shrink-0"><Italic className="w-[16px] h-[16px]" /></button>
 <button type="button" onMouseDown={(e) => { e.preventDefault(); formatText('formatBlock', isReply,'blockquote');}} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent shrink-0"><Quote className="w-[16px] h-[16px]" /></button>
 <button type="button" onMouseDown={(e) => { e.preventDefault(); formatText('formatBlock', isReply,'pre');}} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent mr-1 shrink-0"><Code className="w-[16px] h-[16px]" /></button>
 <div className="w-px h-4 bg-[#e6e8ee] mx-1 shrink-0 hidden sm:block"></div>

 {/* 表情包按钮 */}
 <div className="relative" ref={emojiPickerRef}>
 <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent sm:ml-1 shrink-0">
 <Smile className="w-[16px] h-[16px]" />
 </button>
 {showEmojiPicker && (
 <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 shadow-xl rounded-lg">
 <Suspense fallback={<div className="h-[350px] w-[280px] rounded-lg bg-white/95" aria-label="正在加载表情" />}>
 <EmojiPicker
 onEmojiClick={handleEmojiClick}
 theme={(document.documentElement.classList.contains('dark') ? 'dark' : 'light') as Theme}
 lazyLoadEmojis={true}
 searchDisabled={true}
 skinTonesDisabled={true}
 width={280}
 height={350}
 />
 </Suspense>
 </div>
 )}
 </div>

 {/* 图片上传按钮 */}
 <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent shrink-0">
 {isUploadingImage ? <Loader2 className="w-[16px] h-[16px] animate-spin" /> : <ImageIcon className="w-[16px] h-[16px]" />}
 </button>
 <input type="file" ref={fileInputRef} className="hidden" accept="image/png, image/jpeg, image/gif, image/webp" onChange={handleImageUpload} />

 {/* @好友按钮 */}
 <button type="button" onMouseDown={(e) => {
 e.preventDefault();
 formatText('insertText', isReply,'@');
 const sel = window.getSelection();
 if (sel && sel.rangeCount > 0) {
 const rect = sel.getRangeAt(0).getBoundingClientRect();
 const container = ref.current?.closest('.border-2');
 const containerRect = container ? container.getBoundingClientRect() : { top: 0, left: 0};
 setAtMenuPos({
 top: rect.bottom - containerRect.top + 5,
 left: rect.left - containerRect.left
});
 setShowAtMenu(true);
 setAtFilter('');
}
}} className="p-1.5 text-[#8b98a7] hover:text-[#076dd0] :text-[#C83C23] hover:bg-neutral-100 :bg-[#EAE5D9] rounded-md transition-colors outline-none bg-transparent shrink-0">
 <AtSign className="w-[16px] h-[16px]" />
 </button>
 </div>
 <div className="flex items-center gap-2 shrink-0 sm:ml-2 self-end sm:self-auto w-full sm:w-auto justify-end">
 {isReply && (
 <button type="button" onClick={() => setActiveReplyId(null)} className="px-3 py-1 text-neutral-500 hover:text-neutral-700 :text-[#C83C23] text-[11px] sm:text-[11px] sm:text-[12px] font-bold transition-all bg-transparent">取消</button>
 )}
 <button type="submit" disabled={isSubmitting || !content.trim()} className="px-3 py-1 bg-[#076dd0] hover:bg-[#065baf] :bg-[#C83C23] text-white text-[11px] sm:text-[11px] sm:text-[12px] font-bold rounded-full transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-1 shadow-sm hover:shadow-md hover:scale-105">
 <Send className="w-3 h-3" />
 {isReply ?'回复' :'评论'}
 </button>
 </div>
 </div>
 </div>
 </div>
 </div>
 </form>
 </div>
 </div>
 );
};

 return (
 <div className="w-full mt-20 font-sans __dsqjs_oc95o1" id="dsqjs">
 <div className="relative border-b-2 border-[#e6e8ee] mb-5 pb-0 after:content-[''] after:table after:clear-both">
 <div className="text-[#37475b] text-[15px] font-bold pb-3 relative float-left">
 {comments.length} 条评论
 </div>
 </div>

 <div className="mb-8">
 {renderInputBox(false)}
 <div className="mt-3 ml-2 flex flex-col gap-2 relative z-20">
 {!isLoggedIn ? (
 <>
 <span className="text-[11px] sm:text-[11px] sm:text-[12px] text-[#8b98a7] font-medium tracking-wide whitespace-nowrap">
 通过以下方式登录
 </span>
 <div className="flex items-center gap-2 w-full max-w-[500px]">
 <div className={`flex items-center gap-2 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden origin-right shrink-0 ${showMagicInput ?'w-0 opacity-0 scale-90 translate-x-4 sm:w-auto sm:opacity-100 sm:scale-100 sm:translate-x-0' :'w-auto opacity-100 scale-100 translate-x-0'}`}>
 <button type="button" onClick={(e) => e.preventDefault()} className="w-8 h-8 rounded-full bg-white border border-[#e6e8ee] flex items-center justify-center hover:bg-neutral-50 :border-[#C83C23] transition-all shadow-sm hover:shadow shrink-0">
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 384 512"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.1-44.6-35.9-2.8-74.3 22.7-93.1 22.7-18.9 0-48.6-22.1-80.1-21.6-43.2 .5-83 25.4-105.1 64.9-44.6 79.5-11.4 197.6 32.1 260.6 21.1 30.6 45.5 64.7 78.4 63.5 32.1-1.3 44.5-20.9 83.4-20.9 38.6 0 50.1 20.9 83.4 20.3 34.3-.5 54.8-31.5 75.6-62.1 24.2-35.6 34.2-70.1 34.7-71.9-.8-.4-64.8-24.8-65.2-96.1zM240.1 119c22.8-27.6 38.1-66.1 33.9-104-33.5 1.3-73.4 22.3-96.7 49.8-18.4 21.6-36.9 61.1-31.8 98.1 37.1 2.9 74.4-19.1 94.6-43.9z" fill="#000000" className="" /></svg>
 </button>
 <button type="button" onClick={(e) => e.preventDefault()} className="w-8 h-8 rounded-full bg-white border border-[#e6e8ee] flex items-center justify-center hover:bg-neutral-50 transition-all shadow-sm hover:shadow shrink-0">
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
 </button>
 <button type="button" onClick={(e) => e.preventDefault()} className="w-8 h-8 rounded-full bg-white border border-[#e6e8ee] flex items-center justify-center hover:bg-neutral-50 transition-all shadow-sm hover:shadow shrink-0">
 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 1200 1227"><path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" fill="#000000" className="" /></svg>
 </button>
 <button type="button" onClick={(e) => e.preventDefault()} className="w-8 h-8 rounded-full bg-white border border-[#e6e8ee] flex items-center justify-center hover:bg-neutral-50 transition-all shadow-sm hover:shadow shrink-0">
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" fill="#181717" className="" /></svg>
 </button>
 <button type="button" onClick={(e) => e.preventDefault()} className="w-8 h-8 rounded-full bg-white border border-[#e6e8ee] flex items-center justify-center hover:bg-neutral-50 transition-all shadow-sm hover:shadow shrink-0">
 <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
 </button>
 <button type="button" onClick={(e) => e.preventDefault()} className="w-8 h-8 rounded-full bg-white border border-[#e6e8ee] flex items-center justify-center hover:bg-neutral-50 :border-[#C83C23] transition-all shadow-sm hover:shadow shrink-0">
 <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.7 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
 </button>
 </div>

 <MagicLinkAuth
   showMagicInput={showMagicInput}
   setShowMagicInput={setShowMagicInput}
   magicEmail={magicEmail}
   setMagicEmail={setMagicEmail}
   handleSendMagicLink={handleSendMagicLink}
   isSendingMagic={isSendingMagic}
   countdown={countdown}
   magicMessage={magicMessage}
   theme="dark"
 />
 </div>
</>
 ) : (
 <div className="flex items-center justify-between w-full pr-2 mt-1 animate-in fade-in duration-500">
                <span className="text-[13px] text-[#8b98a7] italic font-serif tracking-wide pl-1">「 {randomPoem} 」</span>
              </div>
 )}
 </div>
 </div>

 <div className="flex items-center justify-between mt-12 mb-6 text-[13px] font-bold relative">
 <div className="flex items-center gap-5">
 <button
 onClick={handleLikeArticle}
 disabled={isLikingArticle}
 className={`flex items-center gap-1.5 transition-colors outline-none bg-transparent ${hasLikedArticle ?'text-[#ef4444]' :'text-[#8b98a7] hover:text-[#ef4444] :text-[#C83C23]'}`}
 >
 <Heart className={`w-[15px] h-[15px] ${hasLikedArticle ?'fill-current' :''}`} />
 <span className="font-medium">喜欢 {articleLikes > 0 ? `(${articleLikes})` :''}</span>
 </button>
 <div className="flex items-center group/share relative">
 <button className="flex items-center gap-1.5 text-[#8b98a7] group-hover/share:text-[#076dd0] :text-[#C83C23] focus-within:text-[#076dd0] transition-colors outline-none bg-transparent relative z-10">
 <Forward className="w-[15px] h-[15px]" />
 <span className="font-medium">分享</span>
 </button>
 <div className="flex items-center transition-all z-50 absolute bottom-full left-1/2 -translate-x-1/2 mb-3 p-2 bg-white border border-[#e6e8ee] rounded-xl shadow-xl opacity-0 invisible translate-y-2 duration-300 group-hover/share:opacity-100 group-hover/share:visible group-hover/share:translate-y-0 sm:static sm:translate-x-0 sm:translate-y-0 sm:mb-0 sm:p-0 sm:bg-transparent sm:border-none sm:rounded-none sm:shadow-none sm:visible sm:overflow-hidden sm:max-w-0 sm:opacity-0 sm:group-hover/share:max-w-[150px] sm:group-hover/share:opacity-100 sm:group-hover/share:ml-2 sm:duration-500 sm:ease-[cubic-bezier(0.4,0,0.2,1)]">
                    <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white border-b border-r border-[#e6e8ee] rotate-45 sm:hidden"></div>
                    <div className="flex items-center gap-2 relative z-10 sm:pl-1 sm:opacity-0 sm:group-hover/share:opacity-100 sm:transition-opacity sm:duration-300 sm:delay-100">
 <button
 title="分享到 X"
 onClick={() => {
 const url = encodeURIComponent(window.location.href);
 const text = encodeURIComponent(document.title);
 window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`,'_blank');
}}
 className="w-[26px] h-[26px] rounded-full flex items-center justify-center bg-neutral-100 hover:bg-neutral-200 :bg-[#E2DDCF] text-[#000000] transition-all outline-none hover:scale-105 shadow-sm"
 >
 <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" /></svg>
 </button>
 <button
 title="分享到 Facebook"
 onClick={() => {
 const url = encodeURIComponent(window.location.href);
 window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`,'_blank');
}}
 className="w-[26px] h-[26px] rounded-full flex items-center justify-center bg-[#1877F2]/10 hover:bg-[#1877F2]/20 :bg-[#E2DDCF] text-[#1877F2] transition-all outline-none hover:scale-105 shadow-sm"
 >
 <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
 </button>
 <button
 title="复制链接"
 onClick={() => {
 const url = window.location.href;
 navigator.clipboard.writeText(url).then(() => {
 showToast({ message: "文章链接已复制到剪贴板！", type: 'success' });
}).catch(() => {
 showToast({ message: "复制失败，请手动复制", type: 'error' });
});
}}
 className="w-[26px] h-[26px] rounded-full flex items-center justify-center bg-[#076dd0]/10 hover:bg-[#076dd0]/20 :bg-[#E2DDCF] text-[#076dd0] transition-all outline-none hover:scale-105 shadow-sm"
 >
 <Link2 className="w-[13px] h-[13px]" />
 </button>
 </div>
 </div>
 </div>
 </div>

 <div className="flex items-center">
 <button onClick={() => setSortOrder('desc')} className={`relative mr-[14px] pb-1 transition-colors bg-transparent border-0 outline-none ${sortOrder ==='desc' ?'text-[#37475b] cursor-default' :'text-[#8b98a7] hover:text-[#37475b] :text-[#C83C23] cursor-pointer'}`}>最新{sortOrder ==='desc' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[14px] h-[3px] rounded-full bg-[#076dd0]"></div>}</button>
 <button onClick={() => setSortOrder('best')} className={`relative mr-[14px] pb-1 transition-colors bg-transparent border-0 outline-none ${sortOrder ==='best' ?'text-[#37475b] cursor-default' :'text-[#8b98a7] hover:text-[#37475b] :text-[#C83C23] cursor-pointer'}`}>最佳{sortOrder ==='best' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[14px] h-[3px] rounded-full bg-[#076dd0]"></div>}</button>
 <button onClick={() => setSortOrder('asc')} className={`relative pb-1 transition-colors bg-transparent border-0 outline-none ${sortOrder ==='asc' ?'text-[#37475b] cursor-default' :'text-[#8b98a7] hover:text-[#37475b] :text-[#C83C23] cursor-pointer'}`}>最早{sortOrder ==='asc' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[14px] h-[3px] rounded-full bg-[#076dd0]"></div>}</button>
 </div>
 </div>

 {loading ? (
 <div className="text-center text-[#37475b] py-10 animate-pulse text-[15px]">正在加载评论...</div>
 ) : commentTree.length > 0 ? (
 <CommentTree
 comments={commentTree}
 currentUser={currentUser}
 activeReplyId={activeReplyId}
 onAction={handleAction}
 onDelete={handleDeleteComment}
 onReply={(comment) => {
 if (!isLoggedIn) {
 showToast({ message: '请先登录再进行回复', type: 'info' });
 return;
 }
 if (activeReplyId === comment.id) {
 setActiveReplyId(null);
 } else {
 setActiveReplyId(comment.id);
 setReplyContent('');
 }
 }}
 onShare={() => {
 navigator.clipboard.writeText(window.location.href)
 .then(() => showToast({ message: '链接已复制，去分享给好友吧！', type: 'success' }))
 .catch(() => showToast({ message: '复制失败，请手动复制浏览器地址栏的链接', type: 'error' }));
 }}
 renderReply={(comment) => renderInputBox(true, comment.parentId || comment.id, comment.user.username)}
 />
 ) : (
 <div className="break-words text-[#37475b] text-[16px] leading-[1.5] mb-[6px] overflow-hidden text-center py-8">这里还没有评论，快来抢沙发！</div>
 )}

 {comments.length > 0 && (
 <div className="border-t-2 border-[#e6e8ee] text-[#4A4A4A] text-[16px] font-bold leading-[1.5] mt-[12px] pr-[10px] pt-[10px] text-right">
 <span className="text-[#64778b]">Powered by <span className="text-[#1f6dda]">ZuiYi</span></span>
 </div>
 )}

 {showEditProfile && currentUser && (
 <EditProfileModal
 initialUsername={currentUser.username}
 initialAvatar={currentUser.avatar}
 initialAvatarDark={currentUser.avatarDark}
 onClose={() => setShowEditProfile(false)}
 onSuccess={(updatedUser) => {
 setCurrentUser({...currentUser, ...updatedUser});
 fetchComments();
}}
 />
 )}
 </div>
 );
};
