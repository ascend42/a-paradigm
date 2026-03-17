import { HeroSection } from './sections/HeroSection';
import { SymbolsSection } from './sections/SymbolsSection';
import { HowItWorksSection } from './sections/HowItWorksSection';
import { MetricsSection } from './sections/MetricsSection';
import { CTASection } from './sections/CTASection';
import styles from './page.module.css';

export default function HomePage() {
  return (
    <div className={styles.museum}>
      <HeroSection />
      <SymbolsSection />
      <HowItWorksSection />
      <MetricsSection />
      <CTASection />
    </div>
  );
}
