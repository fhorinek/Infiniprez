import { useId, type CSSProperties } from 'react'
import type { ShapeData } from './model'
import { getShapeSvgDescriptor } from './shapeStyle'

interface ShapeSvgProps {
  shapeType: 'shape_rect' | 'shape_circle'
  shapeData: ShapeData
  width: number
  height: number
  borderScale?: number
  className?: string
  style?: CSSProperties
  fillBackground?: string | null
}

export function ShapeSvg({
  shapeType,
  shapeData,
  width,
  height,
  borderScale = 1,
  className,
  style,
  fillBackground = null,
}: ShapeSvgProps) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const safeBorderScale = Math.max(0.01, borderScale)
  const scaledBorderWidth = shapeData.borderWidth * safeBorderScale
  const descriptor = getShapeSvgDescriptor(shapeType, shapeData, safeWidth, safeHeight)
  const clipPathId = useId()

  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fillBackground ? (
        <defs>
          <clipPath id={clipPathId} clipPathUnits="userSpaceOnUse">
            {descriptor.kind === 'ellipse' ? (
              <ellipse
                cx={descriptor.cx}
                cy={descriptor.cy}
                rx={descriptor.rx}
                ry={descriptor.ry}
              />
            ) : (
              <path d={descriptor.d} />
            )}
          </clipPath>
        </defs>
      ) : null}
      {fillBackground ? (
        <foreignObject
          x={0}
          y={0}
          width={safeWidth}
          height={safeHeight}
          clipPath={`url(#${clipPathId})`}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: fillBackground,
            }}
          />
        </foreignObject>
      ) : null}
      {descriptor.kind === 'ellipse' ? (
        <ellipse
          cx={descriptor.cx}
          cy={descriptor.cy}
          rx={descriptor.rx}
          ry={descriptor.ry}
          fill="none"
          stroke={shapeData.borderColor}
          strokeWidth={scaledBorderWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={
            shapeData.borderType === 'dashed'
              ? `${scaledBorderWidth * 4} ${scaledBorderWidth * 2}`
              : shapeData.borderType === 'dotted'
                ? `${scaledBorderWidth} ${scaledBorderWidth * 1.8}`
                : undefined
          }
        />
      ) : (
        <path
          d={descriptor.d}
          fill="none"
          stroke={shapeData.borderColor}
          strokeWidth={scaledBorderWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={
            shapeData.borderType === 'dashed'
              ? `${scaledBorderWidth * 4} ${scaledBorderWidth * 2}`
              : shapeData.borderType === 'dotted'
                ? `${scaledBorderWidth} ${scaledBorderWidth * 1.8}`
                : undefined
          }
        />
      )}
    </svg>
  )
}
