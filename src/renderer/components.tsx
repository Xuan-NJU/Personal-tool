import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react';

export type IconName =
  | 'timer'
  | 'calendar'
  | 'settings'
  | 'play'
  | 'pause'
  | 'check'
  | 'reset'
  | 'plus'
  | 'chevron-left'
  | 'chevron-right'
  | 'edit'
  | 'trash'
  | 'cloud'
  | 'cloud-off'
  | 'refresh'
  | 'close'
  | 'sparkle'
  | 'clock'
  | 'database'
  | 'device'
  | 'list-check'
  | 'lightbulb'
  | 'search'
  | 'info'
  | 'bell';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const paths: Record<IconName, ReactNode> = {
    timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.6 1.6M9 2h6M12 2v3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.03 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>,
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M9 5v14M15 5v14" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    reset: <><path d="M4 4v6h6" /><path d="M5.2 15a8 8 0 1 0 .8-7l-2 2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    cloud: <><path d="M17.5 19H6a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 9.5 4.8 4.8 0 0 1 17.5 19Z" /><path d="m9.5 14 1.8 1.8 3.5-3.7" /></>,
    'cloud-off': <><path d="m3 3 18 18M6.3 10.1A4 4 0 0 0 6 18h10.2M8.1 5.3A6.5 6.5 0 0 1 18 9.5a4.8 4.8 0 0 1 2.6 7.2" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5M5.5 9a7.5 7.5 0 0 1 12.4-2.3L20 11M4 13l2.1 4.3A7.5 7.5 0 0 0 18.5 15" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    sparkle: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2ZM6 15l.7 2.3L9 18l-2.3.7L6 21l-.7-2.3L3 18l2.3-.7Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    device: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 17h8M10 7h4" /></>,
    'list-check': <><path d="m4 7 1.7 1.7L9 5.5M4 16l1.7 1.7L9 14.5M12 7h8M12 16h8" /></>,
    lightbulb: <><path d="M9 18h6M10 22h4M8.5 15.5A7 7 0 1 1 15.5 15.5c-.9.7-1.3 1.3-1.5 2.5h-4c-.2-1.2-.6-1.8-1.5-2.5Z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = '560px',
  role = 'dialog',
  closeOnBackdrop = true,
  closeOnEscape = true,
  className = '',
  backdropClassName = '',
}: PropsWithChildren<{
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  width?: string;
  role?: 'dialog' | 'alertdialog';
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  backdropClassName?: string;
}>) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const currentBackdrop = dialogRef.current?.closest<HTMLElement>('.modal-backdrop');
    const obscuredBackdrops = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'))
      .filter((backdrop) => backdrop !== currentBackdrop && Boolean(backdrop.querySelector('.modal')))
      .map((backdrop) => ({
        backdrop,
        ariaHidden: backdrop.getAttribute('aria-hidden'),
        inert: backdrop.inert,
      }));
    obscuredBackdrops.forEach(({ backdrop }) => {
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.inert = true;
    });

    const focusableSelector = [
      'button:not(:disabled)',
      'input:not(:disabled):not([type="hidden"])',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const animationFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const preferred = dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      const first = dialog.querySelector<HTMLElement>(focusableSelector);
      (preferred ?? first ?? dialog).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('.modal[role="dialog"], .modal[role="alertdialog"]'));
      if (!dialog || openDialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (closeOnEscape) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', onKeyDown);
      obscuredBackdrops.forEach(({ backdrop, ariaHidden, inert }) => {
        if (!backdrop.isConnected) return;
        if (ariaHidden === null) backdrop.removeAttribute('aria-hidden');
        else backdrop.setAttribute('aria-hidden', ariaHidden);
        backdrop.inert = inert;
      });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [closeOnEscape, open]);

  if (!open) return null;
  return (
    <div className={`modal-backdrop ${backdropClassName}`.trim()} role="presentation" onMouseDown={(event) => closeOnBackdrop && event.target === event.currentTarget && onClose()}>
      <section
        className={`modal ${className}`.trim()}
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={{ width: `min(100%, ${width})`, maxWidth: width }}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button className="button button-icon" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span className="sr-only">{label}</span>
    </label>
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
