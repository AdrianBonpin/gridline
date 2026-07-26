import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

interface AnimatedModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function AnimatedModal({ open, onClose, children }: AnimatedModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          data-testid="animated-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-canvas/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="glass rounded-2xl p-6 shadow-2xl ring-1 ring-white/10"
            style={{ background: "linear-gradient(145deg, rgba(24,24,27,0.85), rgba(10,10,11,0.65))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}