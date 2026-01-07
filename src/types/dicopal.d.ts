declare module 'dicopal' {
  export function getSequentialColors(
    palette: string,
    count: number
  ): string[] | null;
  
  export function getDivergingColors(
    palette: string,
    count: number
  ): string[] | null;
  
  export function getQualitativeColors(
    palette: string,
    count: number
  ): string[] | null;
}
