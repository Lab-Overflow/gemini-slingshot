import { AiProvider, AiResponse, StrategicHint, StrategicHintRequest, TargetCandidate } from '../../types';

interface Env {
  DEFAULT_AI_PROVIDER?: AiProvider;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

const PROVIDERS: AiProvider[] = ['gemini', 'openai', 'anthropic'];

const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: 'gemini-1.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-3-5-sonnet-latest'
};

const SYSTEM_INSTRUCTION =
  'You are a strategic gaming AI. Return strict JSON only, never markdown. Use concise operational instructions.';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });

const getBestLocalTarget = (validTargets: TargetCandidate[], msg = 'No clear shots-play defensively.'): StrategicHint => {
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

const buildTargetList = (validTargets: TargetCandidate[]) => {
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

const buildPrompt = (dangerRow: number, validTargets: TargetCandidate[]) => {
  const targetList = buildTargetList(validTargets);

  return `
You are analyzing a Bubble Shooter game where player can choose projectile color.

GAME STATE
- Danger Level: ${dangerRow >= 6 ? 'CRITICAL (Bubbles near bottom!)' : 'Stable'}

SCORING RULES
- Red: 100
- Blue: 150
- Green: 200
- Yellow: 250
- Purple: 300
- Orange: 500

AVAILABLE MOVES
${targetList}

TASK
1. Pick BEST color to equip.
2. Pick best target row/col.

PRIORITY
1. High score
2. Avalanche potential
3. Survival if danger is critical

OUTPUT
Raw JSON only:
{
  "message": "Short directive",
  "rationale": "One sentence reason",
  "recommendedColor": "red|blue|green|yellow|purple|orange",
  "targetRow": integer,
  "targetCol": integer
}
`.trim();
};

const extractJsonObject = (text: string): any => {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const candidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
      ? text.slice(firstBrace, lastBrace + 1)
      : text;

  return JSON.parse(candidate);
};

const normalizeHint = (parsed: any): StrategicHint | null => {
  const row = Number(parsed?.targetRow);
  const col = Number(parsed?.targetCol);
  const color = typeof parsed?.recommendedColor === 'string' ? parsed.recommendedColor.toLowerCase() : undefined;

  if (Number.isNaN(row) || Number.isNaN(col) || !color) return null;

  return {
    message: parsed?.message || 'Good shot available!',
    rationale: parsed?.rationale,
    targetRow: row,
    targetCol: col,
    recommendedColor: color as any
  };
};

const fetchGemini = async (apiKey: string, model: string, prompt: string, imageBase64: string) => {
  const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: cleanBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.4,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`Gemini error ${resp.status}: ${raw}`);
  }

  const parsed = JSON.parse(raw);
  const text =
    parsed?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('\n') ||
    parsed?.text ||
    '';

  return {
    text,
    raw
  };
};

const fetchOpenAI = async (apiKey: string, model: string, prompt: string, imageBase64: string) => {
  const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: SYSTEM_INSTRUCTION
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } }
          ]
        }
      ]
    })
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`OpenAI error ${resp.status}: ${raw}`);
  }

  const parsed = JSON.parse(raw);
  const text = parsed?.choices?.[0]?.message?.content || '';

  return {
    text,
    raw
  };
};

const fetchAnthropic = async (apiKey: string, model: string, prompt: string, imageBase64: string) => {
  const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      temperature: 0.4,
      system: SYSTEM_INSTRUCTION,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }
      ]
    })
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`Anthropic error ${resp.status}: ${raw}`);
  }

  const parsed = JSON.parse(raw);
  const text = Array.isArray(parsed?.content)
    ? parsed.content
        .filter((item: any) => item?.type === 'text')
        .map((item: any) => item?.text || '')
        .join('\n')
    : '';

  return {
    text,
    raw
  };
};

const resolveProvider = (env: Env, requested?: string): AiProvider => {
  const lower = String(requested || env.DEFAULT_AI_PROVIDER || 'gemini').toLowerCase();
  if (PROVIDERS.includes(lower as AiProvider)) {
    return lower as AiProvider;
  }
  return 'gemini';
};

const resolveModel = (env: Env, provider: AiProvider, requested?: string): string => {
  if (requested && requested.trim()) return requested.trim();

  if (provider === 'gemini') return env.GEMINI_MODEL || DEFAULT_MODELS.gemini;
  if (provider === 'openai') return env.OPENAI_MODEL || DEFAULT_MODELS.openai;
  return env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
};

const callProvider = async (
  env: Env,
  provider: AiProvider,
  model: string,
  prompt: string,
  imageBase64: string
): Promise<{ text: string; raw: string }> => {
  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY');
    return fetchGemini(env.GEMINI_API_KEY, model, prompt, imageBase64);
  }

  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    return fetchOpenAI(env.OPENAI_API_KEY, model, prompt, imageBase64);
  }

  if (!env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
  return fetchAnthropic(env.ANTHROPIC_API_KEY, model, prompt, imageBase64);
};

export const onRequestPost = async ({ env, request }: { env: Env; request: Request }) => {
  const startedAt = Date.now();

  let body: StrategicHintRequest;
  try {
    body = (await request.json()) as StrategicHintRequest;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body?.imageBase64 || !Array.isArray(body?.validTargets)) {
    return json({ error: 'Missing required fields: imageBase64, validTargets' }, 400);
  }

  const provider = resolveProvider(env, body.provider);
  const model = resolveModel(env, provider, body.model);
  const prompt = buildPrompt(body.dangerRow ?? 0, body.validTargets || []);

  try {
    const providerResult = await callProvider(env, provider, model, prompt, body.imageBase64);

    const parsed = extractJsonObject(providerResult.text || providerResult.raw || '{}');
    const hint = normalizeHint(parsed);

    if (!hint) {
      throw new Error(`Model response missing valid target coords: ${providerResult.text}`);
    }

    const response: AiResponse = {
      hint,
      debug: {
        latency: Date.now() - startedAt,
        rawResponse: providerResult.text || providerResult.raw,
        parsedResponse: parsed,
        promptContext: buildTargetList(body.validTargets),
        provider,
        model,
        timestamp: new Date().toISOString()
      }
    };

    return json(response);
  } catch (error: any) {
    const fallbackHint = getBestLocalTarget(body.validTargets || [], 'AI service unreachable');

    const response: AiResponse = {
      hint: fallbackHint,
      debug: {
        latency: Date.now() - startedAt,
        rawResponse: '',
        parsedResponse: undefined,
        promptContext: buildTargetList(body.validTargets || []),
        provider,
        model,
        error: error?.message || 'Unknown provider error',
        timestamp: new Date().toISOString()
      }
    };

    return json(response);
  }
};
