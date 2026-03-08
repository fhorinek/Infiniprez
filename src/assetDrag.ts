export const ASSET_LIBRARY_DRAG_MIME = 'application/x-infiniprez-asset'

export interface AssetLibraryDragPayload {
  assetId: string
  intrinsicWidth: number
  intrinsicHeight: number
  kind: 'image' | 'video' | 'audio'
}
