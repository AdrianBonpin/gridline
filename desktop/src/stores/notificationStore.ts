import { create } from "zustand";

export interface Notification {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface NotificationState {
  notifications: Notification[];
  notify: (message: string, type?: Notification["type"]) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  notify: (message, type = "info") => {
    const id = `notif-${++counter}`;
    set((s) => ({ notifications: [...s.notifications, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
    }, 4000);
  },
  dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
}));