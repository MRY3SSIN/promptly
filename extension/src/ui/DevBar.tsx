import type React from 'react';
import { useState } from 'react';
import type { SiteAdapter } from '../adapters/types';
import { engineFor } from '../adapters/types';
import { readText, textMatches } from '../io/readText';
import { writeText, type WriteResult } from '../io/writeText';
import { useWidgetStore } from '../store/widgetStore';
import { pasteShortcutLabel } from './Toast';

/**
 * The M2 round-trip harness. Development builds only.
 *
 * M2 is done when a 500-word insert survives on every supported site — and
 * "survives" specifically means the editor's *document model* updated, not just
 * its pixels. Setting `innerHTML` produces a composer that looks correct and
 * sends the old text on Enter, so the only honest check is to write, read back,
 * and compare on the real site.
 *
 * This bar does exactly that and reports which strategy in the chain won, which
 * is the fastest way to notice an editor has changed under us: a site that
 * quietly stops accepting `execCommand` still passes, but starts reporting
 * `synthetic-paste` instead.
 */

const WORD = 'lorem';

export interface DevBarProps {
  adapter: SiteAdapter;
}

/*
 * Styles live here rather than in the stylesheet.
 *
 * The component itself is tree-shaken out of production by the
 * `import.meta.env.MODE` check at its call site, but CSS rules in a shared
 * stylesheet are not eliminated alongside it — so the selectors would ship to
 * every user for a component that can never render. Inline styles keep the
 * dev tooling entirely out of the production bundle.
 */
const BAR: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 8px)',
  display: 'flex',
  gap: 4,
  width: 'max-content',
  padding: 4,
  background: 'var(--forge-surface)',
  border: '1px dashed var(--forge-ochre)',
  borderRadius: 'var(--forge-r-sm)',
  pointerEvents: 'auto',
};

const BUTTON: React.CSSProperties = {
  padding: '3px 6px',
  fontFamily: 'var(--forge-font-mono)',
  fontSize: 10,
  color: 'var(--forge-text)',
  background: 'transparent',
  border: '1px solid var(--forge-hairline)',
  borderRadius: 'var(--forge-r-sm)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function DevBar({ adapter }: DevBarProps) {
  const setToast = useWidgetStore((s) => s.setToast);
  const [result, setResult] = useState<string>('');

  async function run(wordCount: number) {
    const composer = adapter.getComposer();
    if (!composer) {
      setResult('no composer');
      return;
    }

    const engine = engineFor(adapter, composer);
    const text = buildProbe(wordCount);
    setResult('…');

    const write: WriteResult = await writeText(composer, text, engine, {
      onFallback: () => setToast(`Copied — paste it in with ${pasteShortcutLabel()}`),
    });

    // Read it back from the live element rather than trusting the return value,
    // so the bar reports what the editor actually holds.
    const verified = textMatches(readText(composer, engine), text);
    setResult(`${engine} · ${write.strategy ?? 'none'} · ${verified ? 'ok' : 'MISMATCH'}`);
  }

  return (
    <div style={BAR}>
      <button type="button" style={BUTTON} onClick={() => void run(500)}>
        insert 500w
      </button>
      <button type="button" style={BUTTON} onClick={() => void run(12)}>
        12w
      </button>
      <span style={{ alignSelf: 'center', fontSize: 10, opacity: 0.75 }}>{result}</span>
    </div>
  );
}

/**
 * A probe with numbered words and paragraph breaks. Numbering means a partial
 * write is visible as a partial write rather than as "some text is there".
 */
function buildProbe(wordCount: number): string {
  const words: string[] = [];
  for (let i = 1; i <= wordCount; i++) {
    words.push(`${WORD}-${i}`);
    // Paragraph breaks exercise the block handling that separates a real
    // document-model write from a textContent assignment.
    if (i % 60 === 0 && i !== wordCount) words.push('\n\n');
  }
  return words.join(' ').replace(/ \n\n /g, '\n\n');
}
