// Shape of the virtual module that the Vite plugin in vite.config.ts emits.
declare module 'virtual:graph-files' {
  export const graphFileSources: Record<string, string>
  export const graphRootName: string
  export const graphRootPath: string
  export const graphReadOnly: boolean
  export const initialReviewMode: string | null
  export const initialReviewFilters: { include: string; exclude: string }
}
