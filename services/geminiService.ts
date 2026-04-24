/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import {
  StrategicHint,
  AiResponse,
  DebugInfo,
  TargetCandidate,
  StrategicHintRequest,
  AiProvider
} from '../types';

const DEFAULT_PROVIDER: AiProvider = 'gemini';

const getApiEndpoint = () => {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const trimmed = baseUrl.replace(/^\/+|\/+$/g, '');
  const prefix = trimmed ? `/${trimmed}` : '';
  return `${prefix}/api/strategic-hint`;
};

const API_ENDPOINT = getApiEndpoint();

const getBestLocalTarget = (
  validTargets: TargetCandidate[],
  msg = 'No clear shots-play defensively.'
): StrategicHint => {
  if (validTargets.length > 0) {
    const ranked = [...validTargets].sort((a, b) => {
      const scoreA = a.size * a.pointsPerBubble;
      const scoreB = b.size * b.pointsPerBubble;
      return (scoreB - scoreA) || (a.row - b.row);
    });

    const best = ranked[0];
    return {
      message: `Fallback: Select ${best.color.toUpperCase()} at Row ${best.row}`,
      rationale: 'Selected based on highest potential cluster score available locally.',
      targetRow: best.row,
      targetCol: best.col,
      recommendedColor: best.color as any
    };
  }

  return {
    message: msg,
    rationale: 'No valid clusters found to target.'
  };
};

const buildPromptContext = (validTargets: TargetCandidate[]) => {
  if (validTargets.length === 0) {
    return 'NO MATCHES AVAILABLE. Suggest a color to set up a future combo.';
  }

  return validTargets
    .map(
      t =>
        `- OPTION: Select ${t.color.toUpperCase()} (${t.pointsPerBubble} pts/bubble) -> Target [Row ${t.row}, Col ${t.col}]. Cluster Size: ${t.size}. Total Value: ${t.size * t.pointsPerBubble}.`
    )
    .join('\n');
};

export const getStrategicHint = async (
  imageBase64: string,
  validTargets: TargetCandidate[],
  dangerRow: number,
  options?: { provider?: AiProvider; model?: string }
): Promise<AiResponse> => {
  const provider = options?.provider || DEFAULT_PROVIDER;
  const startTime = performance.now();

  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64,
    promptContext: buildPromptContext(validTargets),
    rawResponse: '',
    provider,
    model: options?.model,
    timestamp: new Date().toLocaleTimeString()
  };

  const payload: StrategicHintRequest = {
    imageBase64,
    validTargets,
    dangerRow,
    provider,
    model: options?.model
  };

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '';
      }

      return {
        hint: getBestLocalTarget(validTargets, 'AI service unreachable'),
        debug: {
          ...debug,
          error: `HTTP ${response.status}: ${errorBody || response.statusText}`
        }
      };
    }

    const data = (await response.json()) as AiResponse;

    return {
      hint: data.hint,
      debug: {
        ...debug,
        ...data.debug,
        latency: debug.latency,
        screenshotBase64: imageBase64,
        promptContext: debug.promptContext,
        provider: data.debug?.provider || provider,
        model: data.debug?.model || options?.model
      }
    };
  } catch (error: any) {
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);

    return {
      hint: getBestLocalTarget(validTargets, 'AI service unreachable'),
      debug: {
        ...debug,
        error: error?.message || 'Unknown API Error'
      }
    };
  }
};

export type { TargetCandidate };
