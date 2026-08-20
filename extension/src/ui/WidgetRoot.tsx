import type { SiteAdapter } from '../adapters/types';
import { DevBar } from './DevBar';
import { ScoreHalo } from './ScoreHalo';
import { Toast } from './Toast';

/**
 * Everything that lives in the shadow root, in one subtree.
 *
 * Positioned relative so the toast and the dev bar can anchor to the halo
 * without joining its layout box — the AnchorEngine places a box of exactly
 * `HALO_SIZE`, and anything that widened it would put every avoid-zone and
 * viewport calculation out by the difference.
 */

export interface WidgetRootProps {
  adapter: SiteAdapter;
  onOpen?: () => void;
}

export function WidgetRoot({ adapter, onOpen }: WidgetRootProps) {
  // Compiled out of production builds entirely; the dev bar never ships.
  const showDevTools = import.meta.env.MODE === 'development';

  return (
    <div style={{ position: 'relative', width: 22, height: 22 }}>
      <ScoreHalo onOpen={onOpen} />
      <Toast />
      {showDevTools && <DevBar adapter={adapter} />}
    </div>
  );
}
