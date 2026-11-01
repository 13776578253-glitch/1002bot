/** Inline SVG icons for canvas controls, node states and toolbar buttons. */

/** 纯内联几何矢量图标组件。 */
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1',
    moon: 'M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z',
    plus: 'M5 12h14M12 5v14', minus: 'M5 12h14',
    fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M16 21h5v-5M8 8h8v8H8Z',
    select: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',
    grid: 'M4 4h16v16H4ZM4 12h16M12 4v16',
    group: 'M8 3H3v5M16 3h5v5M3 16v5h5M16 21h5v-5M7 8h4v8H7ZM14 8h3v8h-3Z',
    expand: 'm9 6 6 6-6 6', collapse: 'm6 9 6 6 6-6',
    layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
    close: 'm6 6 12 12M6 18 18 6',
    pin: 'm16 3 5 5-4 2-3 6-2-2-6 3 3-6-2-2 6-3ZM3 21l6-6',
    lock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
    move: 'M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
    undo: 'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12',
    redo: 'm15 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
    check: 'm4 12 5 5L20 6',
    folder: 'M3 7V5h6l2 2h10v13H3V7Z',
    import: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
    export: 'M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5',
    history: 'M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2',
    save: 'M4 3h13l4 4v14H3V3h1ZM7 3v6h10V3M7 21v-8h10v8',
    info: 'M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    warning: 'm12 3 10 18H2L12 3ZM12 9v5M12 17h.01',
    up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} />{name === 'sun' && <circle cx="12" cy="12" r="4" />}</svg>;
}
