/** Connection status chip — online / connecting / offline at a glance. */
import type { SocketStatus } from '../../live/store.js';

const LOOK: Record<SocketStatus, { label: string; dot: string; text: string }> = {
  online: { label: 'Live', dot: 'bg-ok', text: 'text-ok' },
  connecting: { label: 'Linking', dot: 'bg-warn animate-pulse', text: 'text-warn' },
  offline: { label: 'Offline', dot: 'bg-magenta animate-pulse', text: 'text-magenta' },
  idle: { label: 'Idle', dot: 'bg-faint', text: 'text-dim' },
};

export default function ConnectionChip({ status }: { status: SocketStatus }) {
  const look = LOOK[status];
  return (
    <span className={`chip ${look.text}`} title={`Realtime link: ${status}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}
