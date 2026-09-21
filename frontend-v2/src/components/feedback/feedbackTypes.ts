export type FeedbackType = 'bug' | 'requirement';

export interface FriendApplicationData {
  name: string;
  link: string;
  avatar: string;
  description: string;
}

export interface UserNotification {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  isRead: boolean;
  link?: string;
}

export type DashboardModal = 'settings' | 'collections' | 'history' | null;
