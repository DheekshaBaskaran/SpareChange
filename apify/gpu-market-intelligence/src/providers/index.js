import { collectAkash } from './akash.js';
import { collectRunpod } from './runpod.js';
import { collectVast } from './vastai.js';

export const PROVIDERS = ['vastai', 'runpod', 'akash'];

export const COLLECTORS = {
  vastai: collectVast,
  runpod: collectRunpod,
  akash: collectAkash,
};

export const PROVIDER_DISPLAY = {
  vastai: 'Vast.ai',
  runpod: 'RunPod',
  akash: 'Akash Network',
};
