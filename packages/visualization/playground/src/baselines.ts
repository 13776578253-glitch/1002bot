/** Loads the repository report dataset at the application composition boundary. */
import { adaptProgressReports, type ReportDataset } from '../../src/adapters/progress-reports/index.ts';

const source = new URL('../../datasets/progress-reports/architecture.json', import.meta.url);
const dataset: ReportDataset = await (await fetch(source)).json();

export const baselines = adaptProgressReports(dataset);
