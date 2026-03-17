import styles from './SymbolBadge.module.css';

type SymbolType = 'component' | 'flow' | 'gate' | 'signal' | 'aspect';

const SYMBOL_CONFIG: Record<SymbolType, { shape: string; prefix: string }> = {
  component: { shape: '●', prefix: '#' },
  flow:      { shape: '◆', prefix: '$' },
  gate:      { shape: '■', prefix: '^' },
  signal:    { shape: '▲', prefix: '!' },
  aspect:    { shape: '◇', prefix: '~' },
};

interface SymbolBadgeProps {
  type: SymbolType;
  name: string;
  showPrefix?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function SymbolBadge({
  type,
  name,
  showPrefix = true,
  size = 'md',
}: SymbolBadgeProps) {
  const config = SYMBOL_CONFIG[type];

  return (
    <span className={`${styles.badge} ${styles[type]} ${styles[size]}`}>
      <span className={styles.shape}>{config.shape}</span>
      <span className={styles.label}>
        {showPrefix ? `${config.prefix}${name}` : name}
      </span>
    </span>
  );
}
