import { ReactNode, Fragment } from 'react';

interface MarkdownTextProps {
  content: string;
  className?: string;
}

/**
 * Parses a string for simple inline formatting:
 * `backticks` -> inline code
 * **double asterisks** -> bold
 */
export function MarkdownText({ content, className = '' }: MarkdownTextProps) {
  // Regex to match **bold** or `code`
  // We use a simple tokenizer approach
  const parts = content.split(/(\*\*.*?\*\*|`[^`]+`)/g);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-bold text-foreground">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code 
              key={i} 
              className="px-1.5 py-0.5 rounded-md bg-orange-100/50 text-orange-800 font-mono text-[0.875em] border border-orange-200/50"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </span>
  );
}
