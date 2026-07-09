import { AnthropicProvider } from './anthropic.provider';

// SDK client'ı mock'lanır — ağ yok. Döngü davranışı test edilir: tool_use →
// executor → tool_result'lar TEK user mesajında → nihai text.

describe('AnthropicProvider', () => {
  const makeProvider = (createMock: jest.Mock) => {
    const provider = new AnthropicProvider();
    // getClient'ı mock client dönecek şekilde ez (SDK constructor'ı API key ister).
    (provider as unknown as { envClient: unknown }).envClient = {
      messages: { create: createMock },
    };
    return provider;
  };

  const baseRequest = {
    model: 'claude-opus-4-8',
    systemPrompt: 'SYS',
    messages: [{ role: 'user' as const, content: 'Merhaba' }],
    tools: [
      { name: 'echo', description: 'Echo tool', inputSchema: { type: 'object', properties: {} } },
    ],
  };

  it('düz cevap: text bloklarını birleştirir', async () => {
    const create = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Selam!' }],
    });
    const provider = makeProvider(create);
    const result = await provider.runTurn({ ...baseRequest, executeTool: jest.fn() });
    expect(result.text).toBe('Selam!');
    const params = create.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.system).toBe('SYS');
    expect(params.tools[0].name).toBe('echo');
  });

  it('tool döngüsü: paralel tool_use → sonuçlar tek user mesajında → nihai cevap', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Bakıyorum...' },
          { type: 'tool_use', id: 't1', name: 'echo', input: { a: 1 } },
          { type: 'tool_use', id: 't2', name: 'echo', input: { a: 2 } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Sonuç hazır.' }],
      });
    const executeTool = jest
      .fn()
      .mockResolvedValueOnce({ output: 'ok-1' })
      .mockResolvedValueOnce({ output: 'ok-2', isError: true });

    const provider = makeProvider(create);
    const result = await provider.runTurn({ ...baseRequest, executeTool });

    expect(result.text).toBe('Sonuç hazır.');
    expect(executeTool).toHaveBeenCalledTimes(2);
    const secondCallMessages = create.mock.calls[1][0].messages;
    // assistant echo + TEK user mesajında 2 tool_result
    const lastUser = secondCallMessages[secondCallMessages.length - 1];
    expect(lastUser.role).toBe('user');
    expect(lastUser.content).toHaveLength(2);
    expect(lastUser.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(lastUser.content[1]).toMatchObject({ tool_use_id: 't2', is_error: true });
  });

  it('refusal stop_reason hata fırlatır', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'refusal', content: [] });
    const provider = makeProvider(create);
    await expect(provider.runTurn({ ...baseRequest, executeTool: jest.fn() })).rejects.toThrow(
      'refused',
    );
  });

  it('iterasyon tavanı aşılınca hata fırlatır', async () => {
    const create = jest.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'echo', input: {} }],
    });
    const provider = makeProvider(create);
    await expect(
      provider.runTurn({
        ...baseRequest,
        executeTool: jest.fn().mockResolvedValue({ output: 'ok' }),
        maxIterations: 2,
      }),
    ).rejects.toThrow('exceeded 2 iterations');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
