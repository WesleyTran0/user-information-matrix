import type { AccessCoverage } from '../../shared/types/domain.ts';

const LABELS: Record<AccessCoverage, string> = {
  full: 'Full',
  partial: 'Partial',
  none: 'None',
};

interface CoverageBadgeProps {
  coverage: AccessCoverage;
  title?: string;
}

export function CoverageBadge({ coverage, title }: CoverageBadgeProps) {
  return (
    <span className={`badge badge--${coverage}`} title={title}>
      {LABELS[coverage]}
    </span>
  );
}
