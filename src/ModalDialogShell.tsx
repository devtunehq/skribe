import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function ModalDialogShell({
  className,
  labelledBy,
  preventCancel,
  onCancel,
  children
}: {
  className: string;
  labelledBy: string;
  preventCancel?: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const preventCancelRef = useRef(preventCancel);

  onCancelRef.current = onCancel;
  preventCancelRef.current = preventCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    const syncPageHeight = () => {
      const pageHeight = Math.max(
        window.innerHeight,
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
      dialog.style.setProperty("--modal-page-height", `${pageHeight}px`);
    };
    const requestCancel = () => {
      if (!preventCancelRef.current) onCancelRef.current();
    };
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestCancel();
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target === event.currentTarget) requestCancel();
    };

    syncPageHeight();
    window.addEventListener("resize", syncPageHeight);
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("mousedown", handleMouseDown);
    dialog.showModal();

    return () => {
      window.removeEventListener("resize", syncPageHeight);
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("mousedown", handleMouseDown);
      dialog.style.removeProperty("--modal-page-height");
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className={className} aria-labelledby={labelledBy}>
      {children}
    </dialog>
  );
}
