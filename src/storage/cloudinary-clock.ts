import { Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

let clock: { seconds: number; at: number } | undefined;
let syncing: Promise<void> | undefined;

async function syncUploadClock() {
  syncing ??= (async () => {
    const response = await fetch('https://api.cloudinary.com/', {
      method: 'HEAD',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const date = Date.parse(response.headers.get('date') ?? '');
    if (!Number.isFinite(date)) throw new Error('Storage time is unavailable.');
    clock = { seconds: Math.floor(date / 1000), at: performance.now() };
  })().finally(() => {
    syncing = undefined;
  });
  await syncing;
}

export async function withCloudinaryClock<T>(
  upload: (timestamp?: number) => Promise<T>,
): Promise<T> {
  const timestamp = () =>
    clock
      ? Math.floor(clock.seconds + (performance.now() - clock.at) / 1000)
      : undefined;
  try {
    return await upload(timestamp());
  } catch (error) {
    const failure = error as { http_code?: number; message?: string };
    if (
      failure?.http_code !== 400 ||
      !/stale request/i.test(failure.message ?? '')
    )
      throw error;
    Logger.warn(
      'Storage upload timestamp rejected; synchronizing with storage provider.',
      'CloudinaryClock',
    );
    await syncUploadClock();
    return upload(timestamp());
  }
}
