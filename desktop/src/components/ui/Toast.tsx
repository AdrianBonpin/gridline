import { useNotificationStore } from "../../stores/notificationStore";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const STYLES = {
  success: "border-green-500/40 bg-green-500/10 text-green-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  info: "border-accent/40 bg-accent/10 text-accent-muted",
};

export function ToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => {
        const Icon = ICONS[n.type];
        return (
          <div
            key={n.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg animate-in slide-in-from-right-2 ${STYLES[n.type]}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span className="text-sm flex-1">{n.message}</span>
            <button onClick={() => dismiss(n.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}