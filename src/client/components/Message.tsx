interface MessageProps {
  tone: 'info' | 'error';
  title: string;
  detail?: string;
}

/** Shared empty / loading / error presentation. */
export function Message({ tone, title, detail }: MessageProps) {
  return (
    <div className={`message message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="message__title">{title}</p>
      {detail !== undefined && <p className="message__detail">{detail}</p>}
    </div>
  );
}
