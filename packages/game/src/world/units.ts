/** 1m ＝ 1タイル ＝ 16ピクセル（補助仕様書 0.1。仮値）。 */
export const PIXELS_PER_METER = 16;

export const toPixels = (meters: number): number => meters * PIXELS_PER_METER;
export const toMeters = (pixels: number): number => pixels / PIXELS_PER_METER;
