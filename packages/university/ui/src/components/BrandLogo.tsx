import { Seal } from './Seal';
import { usePackConfigStore } from '../store/packConfigStore';

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export function BrandLogo({ size = 36, className }: BrandLogoProps) {
  const config = usePackConfigStore((s) => s.config);
  const logo = config?.branding.logo;

  if (logo) {
    return (
      <img
        src={logo}
        alt={config?.branding.name ?? 'Logo'}
        style={{ width: size, height: size, objectFit: 'contain' }}
        className={className}
      />
    );
  }

  return <Seal size={size} className={className} />;
}
