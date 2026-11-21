import { useState } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import type { DependencyInfo } from "../../lib/types";

interface DependencyDialogProps {
  open: boolean;
  deps: DependencyInfo[];
  onProceed: () => void;
  onCancel: () => void;
  /**
   * Heading. Defaults to "Dependencies".
   *
   * Drop flows that would otherwise raise a second confirmation dialog pass
   * their own heading so this dialog *is* the whole acknowledgement: one
   * dialog, one deliberate action, one staged change.
   */
  title?: string;
  /** Sentence introduced above the dependency list. */
  dependencyNotice?: string;
  /** Extra consequence copy shown under the list (e.g. what the drop loses). */
  message?: string;
  /** The acknowledgement the confirming button requires. */
  acknowledgementLabel?: string;
  /** Label of the confirming button. Defaults to "Proceed". */
  confirmLabel?: string;
}

const DEFAULT_TITLE = "Dependencies";
const DEFAULT_NOTICE =
  "The following depend on this object and will be removed with CASCADE:";
const DEFAULT_ACKNOWLEDGEMENT = "I understand these will be dropped.";

export function DependencyDialog({
  open,
  deps,
  onProceed,
  onCancel,
  title = DEFAULT_TITLE,
  dependencyNotice = DEFAULT_NOTICE,
  message,
  acknowledgementLabel = DEFAULT_ACKNOWLEDGEMENT,
  confirmLabel = "Proceed",
}: DependencyDialogProps) {
  const [ack, setAck] = useState(false);
  const hasDeps = deps.length > 0;

  return (
    <AnimatedModal open={open} onClose={onCancel}>
      <div className="w-[420px]">
        <h3 className="font-heading text-text text-lg mb-3">{title}</h3>
        {hasDeps ? (
          <>
            <p className="text-sm text-red-400 mb-2">{dependencyNotice}</p>
            <ul className="max-h-48 overflow-auto my-2 space-y-1 pr-1">
              {deps.map((d, i) => (
                <li key={i} className="text-sm text-text">
                  {d.name}{" "}
                  <span className="text-text-subtle">({d.class})</span>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-sm text-text-muted mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="accent-accent h-4 w-4"
              />
              {acknowledgementLabel}
            </label>
          </>
        ) : (
          <p className="text-sm text-text-muted">No dependencies — safe to drop.</p>
        )}
        {message && <p className="text-sm text-text-muted mt-3">{message}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onProceed}
            disabled={hasDeps && !ack}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}
