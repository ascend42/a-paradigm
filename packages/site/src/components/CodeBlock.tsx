import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  highlightSymbols?: boolean;
}

/**
 * Syntax-highlighted code block with symbol color highlighting.
 * Detects Paradigm symbol prefixes (#, $, ^, !, ~) and colors them.
 */
export function CodeBlock({
  code,
  language = 'yaml',
  filename,
  highlightSymbols = true,
}: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div className={styles.container}>
      {filename && (
        <div className={styles.header}>
          <span className={styles.filename}>{filename}</span>
          <span className={styles.language}>{language}</span>
        </div>
      )}
      <pre className={styles.pre}>
        <code className={styles.code}>
          {lines.map((line, i) => (
            <span key={i} className={styles.line}>
              <span className={styles.lineNumber}>{i + 1}</span>
              <span className={styles.lineContent}>
                {highlightSymbols ? highlightLine(line) : line}
              </span>
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function highlightLine(line: string): React.ReactNode[] {
  // Match symbol references: #name, $name, ^name, !name, ~name
  const parts = line.split(/((?:^|(?<=\s|"|'|,|\[|\(|:))(?:[#$^!~][a-zA-Z][\w-]*))/);

  return parts.map((part, i) => {
    if (/^#[a-zA-Z]/.test(part)) {
      return <span key={i} className={styles.symComponent}>{part}</span>;
    }
    if (/^\$[a-zA-Z]/.test(part)) {
      return <span key={i} className={styles.symFlow}>{part}</span>;
    }
    if (/^\^[a-zA-Z]/.test(part)) {
      return <span key={i} className={styles.symGate}>{part}</span>;
    }
    if (/^![a-zA-Z]/.test(part)) {
      return <span key={i} className={styles.symSignal}>{part}</span>;
    }
    if (/^~[a-zA-Z]/.test(part)) {
      return <span key={i} className={styles.symAspect}>{part}</span>;
    }
    return part;
  });
}
