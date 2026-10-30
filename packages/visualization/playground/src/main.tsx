import { createRoot } from 'react-dom/client';
import { VisualizationCanvas } from '../../src/react/index.ts';
import { sampleBaselines } from '../../examples/baselines.ts';
import '../../src/react/styles.css';
import './app.css';

createRoot(document.getElementById('root')!).render(<VisualizationCanvas baselines={sampleBaselines} initialBaselineId="M2" />);
