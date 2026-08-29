import { describe, expect, it } from 'vitest';
import { formatUpdateError } from '../../desktop/src/components/UpdateCheckRow';

describe('desktop updater diagnostics', () => {
  it('explains unreachable feeds and signature failures', () => {
    expect(formatUpdateError(new Error('HTTP status 404 Not Found'))).toContain('升级源不可访问');
    expect(formatUpdateError(new Error('Signature verification failed'))).toContain('签名校验失败');
  });
});
