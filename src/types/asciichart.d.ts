declare module 'asciichart' {
  export function plot(series: number[] | number[][], cfg?: {
    height?: number
    colors?: string[]
    format?: (x: number) => string
    padding?: string
    offset?: number
    min?: number
    max?: number
  }): string

  export const blue: string
  export const green: string
  export const red: string
  export const yellow: string
  export const cyan: string
  export const magenta: string
  export const white: string
  export const darkgray: string
  export const lightgray: string
  export const reset: string
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _default: string
  export { _default as default }
}
