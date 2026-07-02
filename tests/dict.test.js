import { loadDictionary } from '../src/dict.js';

function stubFetch(responses) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    for (const [suffix, body] of Object.entries(responses)) {
      if (url.endsWith(suffix)) return Promise.resolve({ json: async () => body });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDictionary', () => {
  test('returns an empty dictionary synchronously, before the fetch resolves', () => {
    stubFetch({ 'data/jmdict.json': {}, 'data/kanjidic2.json': {} });

    const { dictionary } = loadDictionary('');

    expect(dictionary).toStrictEqual({});
  });

  test('populates the same object in place once entries arrive', async () => {
    stubFetch({
      'data/jmdict.json': { 'せんだい': [{ type: 'word', kana: ['せんだい'] }] },
      'data/kanjidic2.json': { '下': [{ type: 'character', readings: [{ value: 'した' }] }] },
    });

    const { dictionary, ready } = loadDictionary('');
    expect(dictionary['せんだい']).toBeUndefined();

    await ready;

    expect(dictionary['せんだい']).toStrictEqual([{ type: 'word', kana: ['せんだい'] }]);
    expect(dictionary['下']).toStrictEqual([{ type: 'character', readings: [{ value: 'した' }] }]);
  });

  test('merges word and kanji entries sharing the same key', async () => {
    stubFetch({
      'data/jmdict.json': { 'か': [{ type: 'word', kana: ['か'] }] },
      'data/kanjidic2.json': { 'か': [{ type: 'character', readings: [{ value: 'か' }] }] },
    });

    const { dictionary, ready } = loadDictionary('');
    await ready;

    expect(dictionary['か']).toStrictEqual([
      { type: 'word', kana: ['か'] },
      { type: 'character', readings: [{ value: 'か' }] },
    ]);
  });
});
