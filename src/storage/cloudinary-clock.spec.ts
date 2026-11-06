describe('Cloudinary upload clock', () => {
  let withClock: typeof import('./cloudinary-clock').withCloudinaryClock;
  beforeEach(() => {
    jest.resetModules();
    withClock = jest.requireActual<typeof import('./cloudinary-clock')>('./cloudinary-clock').withCloudinaryClock;
  });
  afterEach(() => jest.restoreAllMocks());
  it('retries a stale signature with provider time and reuses that clock', async () => {
    const remote = 'Fri, 06 Nov 2026 12:00:00 GMT';
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { headers: { date: remote } }));
    const upload = jest
      .fn()
      .mockRejectedValueOnce({
        http_code: 400,
        message: 'Stale request - reported time is more than 1 hour ago',
      })
      .mockResolvedValue('uploaded');
    await expect(withClock(upload)).resolves.toBe('uploaded');
    expect(upload.mock.calls[0]).toEqual([undefined]);
    expect(upload.mock.calls[1][0]).toBeGreaterThanOrEqual(
      Date.parse(remote) / 1000,
    );
    expect(upload.mock.calls[1][0]).toBeLessThan(Date.parse(remote) / 1000 + 5);
    const another = jest.fn().mockResolvedValue('second');
    await withClock(another);
    expect(another.mock.calls[0][0]).toBeGreaterThanOrEqual(
      Date.parse(remote) / 1000,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.cloudinary.com/',
      expect.objectContaining({ method: 'HEAD', redirect: 'error' }),
    );
  });
  it('does not retry credential or network errors', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const error = { http_code: 401, message: 'Invalid credentials' };
    const upload = jest.fn().mockRejectedValue(error);
    await expect(withClock(upload)).rejects.toBe(error);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a missing Date header without resending the file', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null));
    const upload = jest
      .fn()
      .mockRejectedValue({ http_code: 400, message: 'Stale request' });
    await expect(withClock(upload)).rejects.toThrow(
      'Storage time is unavailable',
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
