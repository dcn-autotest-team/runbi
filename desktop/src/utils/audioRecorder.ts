/**
 * @file desktop/src/utils/audioRecorder.ts
 * 浏览器 / WebView2 麦克风音频录制与标准 WAV 编码器
 */

/**
 * 将 AudioBuffer 转换为标准 16-bit PCM 单声道 WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const channelData = buffer.getChannelData(0);
  const dataLength = channelData.length * 2;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < channelData.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export interface ActiveRecorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

/**
 * 启动麦克风录音
 */
export async function startAudioRecording(): Promise<ActiveRecorder> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前环境不支持录音（未找到麦克风设备或权限受限）');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : '';

  const mediaRecorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.start(100);

  const cleanup = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    cancel: () => {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      cleanup();
    },
    stop: async () => {
      return new Promise<Blob>((resolve, reject) => {
        mediaRecorder.onstop = async () => {
          cleanup();
          try {
            const rawBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            // 尝试通过 AudioContext 转码为标准 16-bit PCM WAV
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (AudioContextClass) {
              try {
                const arrayBuf = await rawBlob.arrayBuffer();
                const ctx = new AudioContextClass();
                const audioBuffer = await ctx.decodeAudioData(arrayBuf);
                await ctx.close().catch(() => {});
                resolve(audioBufferToWav(audioBuffer));
                return;
              } catch {
                // 解码失败时退回原始录音 Blob
              }
            }
            resolve(rawBlob);
          } catch (err) {
            reject(err);
          }
        };
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      });
    },
  };
}
