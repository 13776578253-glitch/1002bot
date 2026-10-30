/** Playground entry point mounting the public canvas with report-derived baselines. */
import { createRoot } from 'react-dom/client';
import { VisualizationCanvas } from '../../src/react/index.ts';
import { baselines } from './baselines.ts';
import '../../src/react/styles.css';
import './app.css';

createRoot(document.getElementById('root')!).render(<VisualizationCanvas baselines={baselines} />);
