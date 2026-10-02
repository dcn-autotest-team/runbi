/**
 * @file shared/core/senseAudioVoice.ts
 * SenseAudio (商汤 Token Plan) 语音识别 (ASR) 与语音合成 (TTS) 客户端
 *
 * - ASR: POST /v1/audio/transcriptions (兼容 OpenAI Audio 规范, Token Plan 支持 senseaudio-asr-1.5-260319)
 * - TTS: POST /v1/t2a_v2 (Token Plan 支持 sensenova-tts-2.0, 70+ 精品音色)
 */

import { SENSEAUDIO_BASE_URL } from './localModels';

export const DEFAULT_SENSEAUDIO_ASR_MODEL = 'senseaudio-asr-1.5-260319';
export const DEFAULT_SENSEAUDIO_TTS_MODEL = 'sensenova-tts-2.0';
export const DEFAULT_SENSEAUDIO_TTS_VOICE = 'female_0038_a'; // 亲切女孩（平稳通用）

export interface SenseAudioTranscribeOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  language?: string;
  fetchImpl?: typeof fetch;
}

export interface SenseAudioSynthesizeOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  voiceId?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 计算 SenseAudio ASR 目标 URL
 */
export function getSenseAudioAsrUrl(endpoint: string = SENSEAUDIO_BASE_URL): string {
  const base = endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return base.endsWith('/v1') ? `${base}/audio/transcriptions` : `${base}/v1/audio/transcriptions`;
}

/**
 * 计算 SenseAudio TTS 目标 URL
 */
export function getSenseAudioTtsUrl(endpoint: string = SENSEAUDIO_BASE_URL): string {
  const base = endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const root = base.replace(/\/v1$/, '');
  return `${root}/v1/t2a_v2`;
}

/**
 * 过滤 Markdown 标记，生成适合 TTS 朗读的纯文本
 */
export function stripMarkdownForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' [代码块] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#+\s+/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/>\s+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\n{2,}/g, '。\n')
    .trim()
    .slice(0, 4000);
}

/**
 * 解码 SenseAudio TTS 返回的音频数据（支持 hex 与 base64）
 */
export function decodeAudioPayload(audioStr: string, format = 'audio/mp3'): Blob {
  const clean = audioStr.trim();
  // 检查是否为 16 进制字符串（SenseAudio 规范为 hex 编码音频）
  const isHex = /^[0-9a-fA-F]+$/.test(clean.slice(0, 50));
  if (isHex) {
    const raw = clean.startsWith('0x') ? clean.slice(2) : clean;
    const len = raw.length;
    const u8 = new Uint8Array(Math.floor(len / 2));
    for (let i = 0; i < len; i += 2) {
      u8[i / 2] = parseInt(raw.substring(i, i + 2), 16);
    }
    return new Blob([u8], { type: format });
  }

  // Base64 降级支持
  const binary = atob(clean);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    u8[i] = binary.charCodeAt(i);
  }
  return new Blob([u8], { type: format });
}

/**
 * 调用 SenseAudio 语音识别 (ASR) 转写音频文件
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options: SenseAudioTranscribeOptions
): Promise<string> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置中填写商汤 API Key');
  }

  const url = getSenseAudioAsrUrl(options.endpoint);
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', options.model || DEFAULT_SENSEAUDIO_ASR_MODEL);
  formData.append('enable_punctuation', 'true');
  if (options.language) {
    formData.append('language', options.language);
  }

  const fetcher = options.fetchImpl || fetch;
  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    let errDetail = '';
    try {
      const errJson = await res.json();
      errDetail = errJson.message || errJson.status_msg || errJson.error?.message || '';
    } catch {
      errDetail = await res.text().catch(() => '');
    }
    throw new Error(errDetail ? `语音识别失败: ${errDetail}` : `语音识别请求失败 (HTTP ${res.status})`);
  }

  const json = await res.json();
  if (json.base_resp && json.base_resp.status_code !== 0) {
    throw new Error(json.base_resp.status_msg || '语音识别处理失败');
  }

  return (json.text || '').trim();
}

/**
 * 调用 SenseAudio 语音合成 (TTS) 生成语音
 */
export async function synthesizeSpeech(
  text: string,
  options: SenseAudioSynthesizeOptions
): Promise<Blob> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置中填写商汤 API Key');
  }

  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    throw new Error('没有可朗读的文本');
  }

  const url = getSenseAudioTtsUrl(options.endpoint);
  const body = {
    model: options.model || DEFAULT_SENSEAUDIO_TTS_MODEL,
    text: cleanText,
    stream: false,
    voice_setting: {
      voice_id: options.voiceId || DEFAULT_SENSEAUDIO_TTS_VOICE,
      speed: options.speed ?? 1.0,
      vol: options.vol ?? 1.0,
      pitch: options.pitch ?? 0,
    },
    audio_setting: {
      format: 'mp3',
      sample_rate: 32000,
      bitrate: 128000,
      channel: 2,
    },
  };

  const fetcher = options.fetchImpl || fetch;
  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errDetail = '';
    try {
      const errJson = await res.json();
      errDetail = errJson.message || errJson.status_msg || errJson.error?.message || '';
    } catch {
      errDetail = await res.text().catch(() => '');
    }
    throw new Error(errDetail ? `语音合成失败: ${errDetail}` : `语音合成请求失败 (HTTP ${res.status})`);
  }

  const json = await res.json();
  if (json.base_resp && json.base_resp.status_code !== 0) {
    throw new Error(json.base_resp.status_msg || '语音合成处理失败');
  }

  if (!json.data?.audio) {
    throw new Error('语音合成服务未返回音频数据');
  }

  return decodeAudioPayload(json.data.audio, 'audio/mp3');
}
