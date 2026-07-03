import { ConvertWo } from '../../src/candidates/convert_wo';

const cw = new ConvertWo();
const get = (raw) => cw.getCandidates(raw).map(c => c.data);

// ConvertWo only fires when を appears at index > 0 (not as the leading char).
// It models を appearing mid-word as the particle pronunciation slip.
describe('ConvertWo', () => {
  test('を mid-word → replaced with お', () => {
    expect(get('みさを')).toStrictEqual(['みさお']);
  });

  test('no を → no candidates', () => {
    expect(get('みさお')).toStrictEqual([]);
  });

  test('を at index 0 → not converted (indexOf check > 0)', () => {
    // を at the start is index 0, so the condition `indexOf('を') > 0` is false
    expect(get('をんな')).toStrictEqual([]);
  });

  test('mixed を in second position', () => {
    expect(get('あをい')).toStrictEqual(['あおい']);
  });
});
