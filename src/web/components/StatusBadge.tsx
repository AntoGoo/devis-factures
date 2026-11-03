import type { Tone } from '../../shared/status';

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`badge tone-${tone}`}>{label}</span>;
}
