declare module 'net-snmp' {
  export const Version2c: number

  export type Varbind = {
    oid: string
    type: number
    value: unknown
  }

  export type Session = {
    get: (
      oids: string[],
      callback: (error: Error | null, varbinds: Varbind[]) => void,
    ) => void
    subtree: (
      oid: string,
      maxRepetitions: number,
      feedCallback: (varbinds: Varbind[]) => boolean | void,
      doneCallback: (error: Error | null) => void,
    ) => void
    close: () => void
  }

  export function createSession(target: string, community: string, options: Record<string, unknown>): Session
  export function isVarbindError(varbind: Varbind): boolean
  export function varbindError(varbind: Varbind): string
}
