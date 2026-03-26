/**
 * Resize handle hook for Intel Analyst sidebar.
 * Encapsulates mousedown/mousemove/mouseup drag logic with
 * localStorage persistence, min/max constraints, and double-click reset.
 */

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

function loadWidth(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== null) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return fallback;
}

function saveWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // ignore storage errors
  }
}

/**
 * Set up sidebar resize drag interaction.
 *
 * @param handleEl    - The draggable handle element (`.intel-resize-handle`)
 * @param sidebarEl  - The sidebar element to resize
 * @param containerEl - Parent container for bounding rect reference
 * @param storageKey  - localStorage key for persisting width
 * @param onResize    - Optional callback invoked on each drag frame with current width
 * @returns cleanup function to remove all event listeners
 */
export function setupSidebarResize(
  handleEl: HTMLElement,
  sidebarEl: HTMLElement,
  containerEl: HTMLElement,
  storageKey: string,
  onResize?: (width: number) => void,
): () => void {
  let dragging = false;

  const applyWidth = (width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    sidebarEl.style.flexBasis = `${clamped}px`;
    sidebarEl.style.flexGrow = '0';
    sidebarEl.style.flexShrink = '0';
    sidebarEl.style.width = 'auto';
    onResize?.(clamped);
  };

  const onMove = (clientX: number) => {
    const rect = containerEl.getBoundingClientRect();
    const newWidth = clientX - rect.left;
    applyWidth(newWidth);
    saveWidth(storageKey, Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)));
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    e.preventDefault();
    onMove(e.clientX);
    window.dispatchEvent(new Event('resize'));
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    handleEl.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handleEl.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    handleEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Double-click to reset to default (340px)
  handleEl.addEventListener('dblclick', () => {
    const DEFAULT_WIDTH = 340;
    applyWidth(DEFAULT_WIDTH);
    saveWidth(storageKey, DEFAULT_WIDTH);
  });

  // Expose current width on handle for external restore
  const DEFAULT_WIDTH = 340;
  const savedWidth = loadWidth(storageKey, DEFAULT_WIDTH);
  applyWidth(savedWidth);

  return () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}
