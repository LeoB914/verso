declare module 'nspell' {
  interface NspellInstance {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): void
    spell(word: string): boolean
  }
  interface NspellConstructor {
    (aff: Uint8Array | ArrayBufferLike, dic: Uint8Array | ArrayBufferLike): NspellInstance
    (dictionary: { aff: Uint8Array; dic: Uint8Array }): NspellInstance
  }
  const Nspell: NspellConstructor
  export default Nspell
}
