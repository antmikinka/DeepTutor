"use client";

/**
 * The "follow along" strip: the prepared speech text — math already spoken in
 * words — rendered as word spans, with the word the voice is currently on lit
 * up. Because the spoken string and the displayed string are the same, the
 * boundary charIndex maps to a word with zero drift.
 */

import { useEffect, useMemo, useRef } from "react";

interface KaraokeTranscriptProps {
  text: string;
  /** 0-based index of the spoken word; -1 before the voice starts. */
  activeWord: number;
  label: string;
}

interface Token {
  part: string;
  /** Whitespace tokens carry -1; spoken words carry their 0-based index. */
  word: number;
}

/** Split keeping whitespace, numbering the spoken words as we go. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let next = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part.trim()) {
      tokens.push({ part, word: next });
      next += 1;
    } else {
      tokens.push({ part, word: -1 });
    }
  }
  return tokens;
}

export function KaraokeTranscript({ text, activeWord, label }: KaraokeTranscriptProps) {
  const activeRef = useRef<HTMLSpanElement | null>(null);
  const tokens = useMemo(() => tokenize(text), [text]);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeWord]);

  return (
    <div
      data-karaoke
      aria-label={label}
      className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 text-sm leading-relaxed"
    >
      {tokens.map(({ part, word }, index) => {
        if (word < 0) return <span key={index}>{part}</span>;
        const isActive = word === activeWord;
        return (
          <span
            key={index}
            ref={isActive ? activeRef : undefined}
            data-active={isActive ? "true" : undefined}
            className={
              isActive
                ? "rounded bg-[var(--primary)] px-0.5 font-medium text-[var(--primary-foreground)]"
                : undefined
            }
          >
            {part}
          </span>
        );
      })}
    </div>
  );
}
