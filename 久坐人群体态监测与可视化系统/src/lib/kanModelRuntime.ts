import artifact from './kan_model_artifact.json';

export type KanLabel = 'TUP' | 'TLF' | 'TLB' | 'TLR' | 'TLL';

type KanArtifact = {
  model_type: string;
  labels: KanLabel[];
  feature_cols: string[];
  scaler_mean: number[];
  scaler_scale: number[];
  kan: {
    grid: number[];
    spline_coef: number[][][];
    linear_weight: number[][];
    linear_bias: number[];
    bias: number[];
  };
  runtime?: {
    target_subjects?: number[];
    calibration_source?: string;
    special_subjects?: number[];
  };
};

const MODEL = artifact as KanArtifact;

export interface KanRuntimeInput {
  neck_angle: number;
  head_depth_delta: number;
  depth_delta: number;
  torso_tilt: number;
  shoulder_diff: number;
  shoulder_width: number;
  signed_tilt: number;
}

export interface KanRuntimeOutput {
  label: KanLabel;
  probs: Record<KanLabel, number>;
  logits: number[];
}

function softmax(values: number[]) {
  const max = Math.max(...values);
  const exps = values.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(v => v / sum);
}

function matVecMul(mat: number[][], vec: number[]) {
  return mat.map(row => row.reduce((sum, value, idx) => sum + value * vec[idx], 0));
}

function linearInterpBasis(x: number, grid: number[]) {
  const knots = grid.length;
  const clamped = Math.max(grid[0], Math.min(grid[knots - 1], x));
  let right = 1;
  while (right < knots && grid[right] < clamped) right++;
  if (right >= knots) right = knots - 1;
  const left = Math.max(0, right - 1);
  const leftX = grid[left];
  const rightX = grid[right];
  const denom = Math.max(1e-6, rightX - leftX);
  const t = (clamped - leftX) / denom;
  const basis = new Array(knots).fill(0);
  basis[left] += 1 - t;
  basis[right] += t;
  return basis;
}

function normalizeFeatures(input: KanRuntimeInput) {
  const values = [
    input.neck_angle,
    input.head_depth_delta,
    input.depth_delta,
    input.torso_tilt,
    input.shoulder_diff,
    input.shoulder_width,
    input.signed_tilt,
  ];
  return values.map((v, idx) => (v - MODEL.scaler_mean[idx]) / Math.max(1e-6, MODEL.scaler_scale[idx]));
}

export function predictKan(input: KanRuntimeInput): KanRuntimeOutput {
  const x = normalizeFeatures(input);
  const grid = MODEL.kan.grid;
  const numFeatures = MODEL.feature_cols.length;
  const numKnots = grid.length;
  const numClasses = MODEL.labels.length;

  const splineSums = new Array(numClasses).fill(0);
  for (let f = 0; f < numFeatures; f++) {
    const basis = linearInterpBasis(x[f], grid);
    for (let k = 0; k < numKnots; k++) {
      const coeffs = MODEL.kan.spline_coef[f][k];
      for (let c = 0; c < numClasses; c++) {
        splineSums[c] += basis[k] * coeffs[c];
      }
    }
  }

  const linearPart = matVecMul(MODEL.kan.linear_weight, x);
  const logits = splineSums.map((v, c) => v + linearPart[c] + MODEL.kan.bias[c] + MODEL.kan.linear_bias[c]);
  const probsArr = softmax(logits);
  const probs = MODEL.labels.reduce((acc, label, idx) => {
    acc[label] = probsArr[idx];
    return acc;
  }, {} as Record<KanLabel, number>);
  const bestIdx = probsArr.indexOf(Math.max(...probsArr));
  return {
    label: MODEL.labels[bestIdx],
    probs,
    logits,
  };
}

export function getKanRuntimeMeta() {
  return MODEL.runtime ?? {};
}
