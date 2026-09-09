/**
 * @file shared/core/jsonParser.ts
 * Robust LLM JSON Parser with Auto-Repair and Fallback Engine
 * Handles common model anomalies: missing braces, YAML key-values, unquoted keys,
 * unquoted string literals, single quotes, trailing commas, and unclosed JSON.
 */

export function cleanExtractedScalar(val: string): any {
  let v = val.trim();
  v = v.replace(/[,;]+$/, '').replace(/\/\/.*$/, '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (/^(?:true|是|yes)$/i.test(v)) return true;
  if (/^(?:false|否|no)$/i.test(v)) return false;
  if (/^(?:null|无)$/i.test(v)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseModelJson<T>(raw: string): T {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty raw output');
  }

  // 1. Remove reasoning / thinking blocks (<think>...</think>, <thought>...</thought>)
  let text = raw
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/gi, '')
    .trim();

  // 2. Extract code block content if wrapped in ```json ... ``` or ```yaml ... ```
  const codeBlockMatch = text.match(/```(?:json|yaml)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1].trim()) {
    text = codeBlockMatch[1].trim();
  } else {
    text = text.replace(/^```(?:json|yaml)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  // 3. Locate outer JSON object { ... } or array [ ... ]
  let candidate = '';
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidate = text.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    candidate = text.slice(firstBracket, lastBracket + 1);
  } else if (firstBrace !== -1) {
    // Truncated JSON missing closing brace
    candidate = text.slice(firstBrace) + '\n}';
  } else {
    // No braces at all! (e.g. YAML key-value pairs or loose json properties)
    candidate = text.includes(':') ? '{\n' + text + '\n}' : text;
  }

  // Attempt 1: Direct JSON.parse
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Continue to repairs
  }

  // Attempt 2: Auto-repair common JSON syntax defects
  try {
    let repaired = candidate;
    if (!repaired.trim().startsWith('{') && !repaired.trim().startsWith('[')) {
      repaired = '{\n' + repaired + '\n}';
    }
    // Quote unquoted keys at start of line or after { / ,
    repaired = repaired.replace(/([{\n,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');
    // Convert single-quoted strings: 'val' -> "val"
    repaired = repaired.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ': "$1"');
    // Quote common unquoted string values (other, me, none)
    repaired = repaired.replace(/:\s*(other|me|none)\b/gi, ': "$1"');
    // Normalize booleans & null
    repaired = repaired.replace(/:\s*(?:true|是|yes)\b/gi, ': true');
    repaired = repaired.replace(/:\s*(?:false|否|no)\b/gi, ': false');
    repaired = repaired.replace(/:\s*(?:null|无)\b/gi, ': null');
    // Remove trailing commas
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    // Missing commas between lines
    repaired = repaired.replace(/(["\d]|true|false|null)\s*\n(\s*"[A-Za-z_$][\w$-]*"\s*:)/g, '$1,\n$2');

    return JSON.parse(repaired) as T;
  } catch {
    // Continue to regex dictionary fallback
  }

  // Attempt 3: Line-by-line key-value regex extraction (robust against YAML / loose outputs)
  const dict: Record<string, any> = {};
  const lines = text.split(/\r?\n/);
  let currentKey = '';
  let currentValue = '';

  for (const line of lines) {
    const kvMatch = line.match(/^\s*["']?([A-Za-z_$][\w$-]*)["']?\s*[:=]\s*(.*)$/);
    if (kvMatch) {
      if (currentKey) {
        dict[currentKey] = cleanExtractedScalar(currentValue);
      }
      currentKey = kvMatch[1];
      currentValue = kvMatch[2];
    } else if (currentKey) {
      currentValue += '\n' + line;
    }
  }
  if (currentKey) {
    dict[currentKey] = cleanExtractedScalar(currentValue);
  }

  if (Object.keys(dict).length > 0) {
    return dict as T;
  }

  throw new Error(`Failed to parse model output as JSON: ${text.slice(0, 80)}`);
}
