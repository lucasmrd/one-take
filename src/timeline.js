// The whole film lives on one axis: u ∈ [0, TOTAL]. Scroll moves along it.

export const TOTAL = 1000;

// who owns the frame when no transition is running
export const SOLO = [
  [0, 236, 'forest'],
  [244, 276, 'eyeIn'],
  [294, 508, 'space'],
  [532, 704, 'magic'],
  [730, 856, 'city'],
  [882, 922, 'orbit'],
  [932, 1001, 'eyeOut'],
];

// mode: 1 iris · 2 rune ring · 3 circuit dissolve · 4 flash cut · 5 crossfade
export const TRANSITIONS = [
  { from: 'forest', to: 'eyeIn', start: 236, end: 244, mode: 4 },
  { from: 'eyeIn', to: 'space', start: 276, end: 294, mode: 1 },
  { from: 'space', to: 'magic', start: 508, end: 532, mode: 2 },
  { from: 'magic', to: 'city', start: 704, end: 730, mode: 3 },
  { from: 'city', to: 'orbit', start: 856, end: 882, mode: 5 },
  { from: 'orbit', to: 'eyeOut', start: 922, end: 932, mode: 5 },
];

export const CAPTIONS = [
  [1.5, 18, 'TRANSMISSÃO 001 · SINAL ESTABELECIDO', 'mono'],
  [22, 44, 'Dizem que a floresta lembra de quem passa por ela.'],
  [80, 97, 'Nem tudo que te observa daqui está vivo do mesmo jeito.'],
  [108, 126, 'Alguns chamados atravessam mundos.'],
  [150, 170, 'E alguns guardiões só aparecem uma vez.'],
  [203, 213, 'Não desvie o olhar.'],
  [250, 268, 'Todo olho guarda um universo.'],
  [324, 344, 'Os antigos desenharam animais no céu.'],
  [346, 366, 'Eles nunca foram desenhos.'],
  [458, 480, 'Até a luz se curva para voltar para casa.'],
  [545, 566, 'Do outro lado, magia é só física que ainda não foi escrita.'],
  [740, 760, '…e física é só magia que alguém escreveu.'],
  [894, 914, 'De longe, tudo vira uma luz pequena.'],
  [940, 952, 'Você achou que estava observando.'],
  [953, 966, 'Eles sempre estiveram olhando para você.'],
];

// one-shot sounds (fired when the playhead crosses them going forward)
export const EVENTS = [
  [33, 'flutter'],
  [46.5, 'snort'],
  [106.5, 'howl'],
  [111.2, 'howlFar1'],
  [113.6, 'howlFar2'],
  [117.5, 'howlFar3'],
  [197, 'sparkle'],
  [215.6, 'roar'],
  [225, 'riser'],
  [239.4, 'boom'],
  [286, 'whoosh'],
  [347, 'howlCosmic'],
  [492, 'riserLong'],
  [512, 'chimeSwell'],
  [516, 'boom'],
  [652, 'chimeSwell'],
  [662, 'boom'],
  [706, 'zap'],
  [742, 'boomSoft'],
  [860, 'whoosh'],
  [925, 'whooshSoft'],
  [969.5, 'blink'],
];

// heavier scroll around the big moments
const RESIST = [[208, 232, 0.4], [266, 292, 0.55], [494, 520, 0.5], [646, 668, 0.6], [958, 972, 0.5]];
export function resist(u) {
  for (const [a, b, k] of RESIST) if (u > a && u < b) return k;
  return 1;
}

export function soloAt(u) {
  for (const [a, b, w] of SOLO) if (u >= a && u < b) return w;
  return u < 500 ? 'forest' : 'eyeOut';
}
