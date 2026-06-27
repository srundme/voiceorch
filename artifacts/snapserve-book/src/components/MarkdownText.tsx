import { ReactNode, Fragment } from 'react';

interface MarkdownTextProps {
  content: string;
  className?: string;
}

/**
 * Parses a string for simple inline formatting:
 * `backticks` -> inline code
 * **double asterisks** -> bold
 * *single asterisks* -> italic
 */
export function MarkdownText({ content, className = '' }: MarkdownTextProps) {
  // Tokenize on **bold**, *italic*, or `code`.
  // Bold is matched before italic so `**x**` never matches the italic branch.
  // The italic branch requires a non-space char right after the opening `*`
  // so stray asterisks (e.g. "2 * 3") are not treated as emphasis.
  const parts = content.split(/(\*\*.*?\*\*|\*[^*\s][^*\n]*?\*|`[^`]+`)/g);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-bold text-foreground">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={i} className="italic">{part.slice(1, -1)}</em>;
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
