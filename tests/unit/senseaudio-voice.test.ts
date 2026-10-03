/**
 * @file tests/unit/senseaudio-voice.test.ts
 * SenseAudio (商汤 Token Plan) ASR 语音识别与 TTS 语音合成测试
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_SENSEAUDIO_ASR_MODEL,
  DEFAULT_SENSEAUDIO_TTS_MODEL,
  DEFAULT_SENSEAUDIO_TTS_VOICE,
  getSenseAudioAsrUrl,
  getSenseAudioTtsUrl,
  stripMarkdownForSpeech,
  decodeAudioPayload,
  transcribeAudio,
  synthesizeSpeech,
} from '@runbi/shared/core';
import { audioBufferToWav, startAudioRecording } from '../../desktop/src/utils/audioRecorder';

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

describe('SenseAudio Voice URL Resolvers', () => {
  it('resolves ASR endpoints correctly', () => {
    expect(getSenseAudioAsrUrl()).toBe('https://api.senseaudio.cn/v1/audio/transcriptions');
    expect(getSenseAudioAsrUrl('https://api.senseaudio.cn/v1')).toBe('https://api.senseaudio.cn/v1/audio/transcriptions');
    expect(getSenseAudioAsrUrl('https://api.senseaudio.cn')).toBe('https://api.senseaudio.cn/v1/audio/transcriptions');
    expect(getSenseAudioAsrUrl('http://localhost:8000/v1/')).toBe('http://localhost:8000/v1/audio/transcriptions');
  });

  it('resolves TTS endpoints correctly', () => {
    expect(getSenseAudioTtsUrl()).toBe('https://api.senseaudio.cn/v1/t2a_v2');
    expect(getSenseAudioTtsUrl('https://api.senseaudio.cn/v1')).toBe('https://api.senseaudio.cn/v1/t2a_v2');
    expect(getSenseAudioTtsUrl('https://api.senseaudio.cn')).toBe('https://api.senseaudio.cn/v1/t2a_v2');
    expect(getSenseAudioTtsUrl('http://localhost:8000/v1/')).toBe('http://localhost:8000/v1/t2a_v2');
  });
});

describe('stripMarkdownForSpeech', () => {
  it('strips code blocks, formatting, and links for speech', () => {
    const markdown = `# 标题
这是 **加粗** 和 *斜体* 内容，还有 [链接](https://example.com)。

\`\`\`rust
fn main() { println!("hello"); }
\`\`\`

- 列表项1
- 列表项2
> 引用内容
`;
    const clean = stripMarkdownForSpeech(markdown);
    expect(clean).not.toContain('```');
    expect(clean).not.toContain('**');
    expect(clean).not.toContain('#');
    expect(clean).toContain('[代码块]');
    expect(clean).toContain('加粗');
    expect(clean).toContain('斜体');
    expect(clean).toContain('链接');
    expect(clean).toContain('列表项1');
  });
});

describe('decodeAudioPayload', () => {
  it('decodes hex encoded audio string into blob', async () => {
    // Hex representation of bytes: [0x48, 0x65, 0x6c, 0x6c, 0x6f] = "Hello"
    const hex = '48656c6c6f';
    const blob = decodeAudioPayload(hex, 'audio/mp3');
    expect(blob.type).toBe('audio/mp3');
    const buf = await blobToArrayBuffer(blob);
    const text = new TextDecoder().decode(buf);
    expect(text).toBe('Hello');
  });

  it('decodes base64 encoded audio string into blob', async () => {
    const base64 = btoa('Hello World');
    const blob = decodeAudioPayload(base64, 'audio/mp3');
    const buf = await blobToArrayBuffer(blob);
    const text = new TextDecoder().decode(buf);
    expect(text).toBe('Hello World');
  });
});

describe('transcribeAudio (SenseAudio Token Plan ASR)', () => {
  it('throws when API key is missing', async () => {
    const blob = new Blob(['fake audio'], { type: 'audio/wav' });
    await expect(transcribeAudio(blob, { apiKey: '' })).rejects.toThrow('未配置 API Key');
  });

  it('sends audio to ASR endpoint and returns transcribed text', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody: any = null;

    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = (init?.headers as any)?.Authorization || '';
      capturedBody = init?.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: '今天天气真不错，我们去散步吧。',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const blob = new Blob(['audio-content'], { type: 'audio/wav' });
    const text = await transcribeAudio(blob, {
      apiKey: 'sk-test-asr-key',
      fetchImpl,
    });

    expect(capturedUrl).toBe('https://api.senseaudio.cn/v1/audio/transcriptions');
    expect(capturedAuth).toBe('Bearer sk-test-asr-key');
    expect(capturedBody).toBeInstanceOf(FormData);
    expect(capturedBody.get('model')).toBe(DEFAULT_SENSEAUDIO_ASR_MODEL);
    expect(capturedBody.get('enable_punctuation')).toBe('true');
    expect(text).toBe('今天天气真不错，我们去散步吧。');
  });

  it('handles API error responses', async () => {
    const fetchImpl = (async () => {
      return {
        ok: false,
        status: 401,
        json: async () => ({ message: 'incorrect API key provided' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const blob = new Blob(['audio-content'], { type: 'audio/wav' });
    await expect(
      transcribeAudio(blob, { apiKey: 'bad-key', fetchImpl })
    ).rejects.toThrow('语音识别失败: incorrect API key provided');
  });
});

describe('synthesizeSpeech (SenseAudio Token Plan TTS)', () => {
  it('throws when API key is missing', async () => {
    await expect(synthesizeSpeech('你好', { apiKey: '' })).rejects.toThrow('未配置 API Key');
  });

  it('throws when text is empty', async () => {
    await expect(synthesizeSpeech('   ', { apiKey: 'key' })).rejects.toThrow('没有可朗读的文本');
  });

  it('sends text to TTS endpoint and returns decoded audio Blob', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedJson: any = null;

    const hexAudio = '48656c6c6f20545453'; // "Hello TTS"

    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = (init?.headers as any)?.Authorization || '';
      capturedJson = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            audio: hexAudio,
            status: 2,
          },
          base_resp: { status_code: 0 },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const audioBlob = await synthesizeSpeech('你好世界', {
      apiKey: 'sk-test-tts-key',
      fetchImpl,
    });

    expect(capturedUrl).toBe('https://api.senseaudio.cn/v1/t2a_v2');
    expect(capturedAuth).toBe('Bearer sk-test-tts-key');
    expect(capturedJson.model).toBe(DEFAULT_SENSEAUDIO_TTS_MODEL);
    expect(capturedJson.voice_setting.voice_id).toBe(DEFAULT_SENSEAUDIO_TTS_VOICE);
    expect(capturedJson.text).toBe('你好世界');

    const buf = await blobToArrayBuffer(audioBlob);
    const str = new TextDecoder().decode(buf);
    expect(str).toBe('Hello TTS');
  });
});

describe('audioBufferToWav', () => {
  it('encodes AudioBuffer into valid WAV format with 44-byte header', async () => {
    const sampleRate = 16000;
    const length = 1600; // 0.1s
    const channelData = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      channelData[i] = Math.sin((i / sampleRate) * 440 * 2 * Math.PI);
    }

    const mockAudioBuffer = {
      sampleRate,
      numberOfChannels: 1,
      length,
      duration: 0.1,
      getChannelData: (_channel: number) => channelData,
    } as unknown as AudioBuffer;

    const wavBlob = audioBufferToWav(mockAudioBuffer);
    expect(wavBlob.type).toBe('audio/wav');
    expect(wavBlob.size).toBe(44 + length * 2);

    const buf = await blobToArrayBuffer(wavBlob);
    const view = new DataView(buf);

    // Check RIFF header
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    expect(riff).toBe('RIFF');

    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    expect(wave).toBe('WAVE');

    // Sample rate at offset 24
    expect(view.getUint32(24, true)).toBe(16000);
    // Bits per sample at offset 34
    expect(view.getUint16(34, true)).toBe(16);
  });
});

describe('startAudioRecording error translation', () => {
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
  });

  it('translates NotFoundError / Requested device not found into friendly Chinese message', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const err = new Error('Requested device not found');
          err.name = 'NotFoundError';
          throw err;
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(startAudioRecording()).rejects.toThrow('未检测到麦克风音频输入设备，请连接麦克风后重试');
  });

  it('translates NotAllowedError / Permission denied into friendly Chinese message', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const err = new Error('Permission denied');
          err.name = 'NotAllowedError';
          throw err;
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(startAudioRecording()).rejects.toThrow('麦克风权限未开启，请在系统设置中允许应用访问麦克风');
  });

  it('translates NotReadableError into friendly Chinese message', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          const err = new Error('Device in use');
          err.name = 'NotReadableError';
          throw err;
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(startAudioRecording()).rejects.toThrow('麦克风正被其他应用占用，无法启动录音');
  });
});

